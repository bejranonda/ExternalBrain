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
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      // A raw SyntaxError from req.json() isn't a ZodError, so without this
      // it falls through to authErrorResponse's generic catch-all as a 500
      // instead of a proper 400 (2026-07-17 CodeRabbit finding).
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
        { status: 400 },
      );
    }
    const body = bodySchema.parse(json);
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
    // setting, just an override knob. Deliberately `||`, not `??`: compose's
    // `${MEETING_EXTRACT_MODEL:-}` passthrough sets an empty string (not
    // undefined) in the container when the operator hasn't overridden it,
    // and `??` treats "" as present — it would never fall through to
    // KEA_MODEL/the default. autoskill-classifier.ts's identical `??` chain
    // has the same latent gap; out of scope for this branch to fix there too.
    const model = process.env["MEETING_EXTRACT_MODEL"] || process.env["KEA_MODEL"] || "qwen3-coder";
    const extracted = await meetingExtract.extractMeeting(body.transcript, model);

    // Bounds worst-case cost/latency of this LLM-embedding-backed enrichment
    // step for an unusually large decision list — each entry is a separate
    // embedding-provider call via an unrestricted Promise.all (2026-07-17
    // CodeRabbit finding). 20 is clearly generous for a real meeting; every
    // extracted decision still appears in the response, just without a
    // `supersedes` hint beyond the cap, rather than being dropped.
    const SUPERSESSION_ENRICHMENT_CAP = 20;
    const decisionsWithSupersession = await Promise.all(
      extracted.decisions.map(async (d, i) => {
        if (i >= SUPERSESSION_ENRICHMENT_CAP) {
          return { ...d, supersedes: null };
        }
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
