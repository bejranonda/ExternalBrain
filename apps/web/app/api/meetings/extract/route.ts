/**
 * POST /api/meetings/extract — flag-gated, rate-limited meeting-transcript
 * extraction (spec 2026-07-13). Stateless: does NOT write to the database.
 * The caller reviews the extracted decisions/action-items client-side and
 * confirms them individually through the existing POST /api/knowledge path
 * (Task 8) — this route only extracts + enriches with supersession
 * candidates + org member list for the assignee picker.
 */
import { z } from "zod";
import { db } from "@brain/db";
import {
  envForWeb,
  meetingExtract,
  listOrgMembers,
  requireOrgMember,
  rateLimitCheck,
} from "@brain/core";
import type { Limit } from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";

const bodySchema = z.object({
  transcript: z.string().min(1).max(50_000),
});

function meetingExtractLimit(): Limit {
  return {
    name: "meeting-extract",
    max: envForWeb().RATE_LIMIT_MEETING_EXTRACT_PER_DAY,
    windowMs: 24 * 60 * 60 * 1000,
  };
}

export async function POST(req: Request): Promise<Response> {
  try {
    // Operator kill-switch — this is a new LLM-cost-incurring surface,
    // dark by default (env.ts MEETING_UPLOAD_ENABLED, default false).
    if (!envForWeb().MEETING_UPLOAD_ENABLED) {
      return Response.json(
        { error: { code: "NOT_ENABLED", message: "Meeting upload is not enabled on this deployment." } },
        { status: 503 },
      );
    }

    const userId = await getCurrentUserId();
    const body = bodySchema.parse(await req.json());
    const { projectId, orgId } = await getActiveProject(userId);

    // Any member may read the member list (matches GET /api/orgs/:orgId/members);
    // also a cheap defense-in-depth check ahead of the costly LLM call below —
    // getActiveProject only ever resolves orgs the caller already belongs to,
    // so this is not expected to fail in practice.
    await requireOrgMember(db, userId, orgId);

    const store = await getRateLimitStore();
    const rl = await rateLimitCheck(store, userId, meetingExtractLimit(), Date.now());
    if (!rl.ok) {
      return Response.json(
        { error: { code: "RATE_LIMITED", message: "Daily meeting-extraction limit reached." } },
        { status: 429 },
      );
    }

    // Same provider-model-selection convention as kea.ts / autoskill-classifier.ts
    // (KEA_MODEL / AUTOSKILL_MODEL): read directly from process.env, not the
    // envForWeb() schema — this var is deliberately not a validated deployment
    // setting, just an override knob.
    const model = process.env["MEETING_EXTRACT_MODEL"] ?? process.env["KEA_MODEL"] ?? "qwen3-coder";
    const extracted = await meetingExtract.extractMeeting(body.transcript, model);

    const decisionsWithSupersession = await Promise.all(
      extracted.decisions.map(async (d) => {
        // Fail soft per-decision (e.g. EMBEDDING_NO_PROVIDER on a deployment
        // without an embedding key configured) — a supersession-lookup outage
        // shouldn't sink the whole extraction.
        const candidates = await meetingExtract
          .findSupersessionCandidates({ ruleText: d.ruleText, projectId, userId, limit: 1 })
          .catch(() => []);
        return { ...d, supersedes: candidates[0] ?? null };
      }),
    );

    const members = await listOrgMembers(db, orgId);

    return Response.json({
      decisions: decisionsWithSupersession,
      actionItems: extracted.actionItems,
      members: members.map((m) => ({ email: m.email, name: m.name })),
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
