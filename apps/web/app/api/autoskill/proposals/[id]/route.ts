import { db } from "@brain/db";
import { autoskill } from "@brain/core";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { toProposalView } from "@/lib/brain/views";

const bodySchema = z.object({
  action: z.enum(["apply", "reject", "unreject"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const body = bodySchema.parse(await req.json());

    // Audit R1 (#103): atomic compare-and-claim via `updateMany` flips
    // status from pending → applying in a single statement. Two
    // concurrent applies (double-click, webhook retry) can no longer
    // both pass the pre-check; whichever one wins the update gets
    // count=1, the other gets count=0 and bails with 409. applyProposal
    // accepts either pending or applying as the start state, so it
    // still runs through its switch case and finalizes to applied.
    if (body.action === "apply") {
      const claim = await db.autoskillProposal.updateMany({
        where: { id, userId, status: "pending" },
        data: { status: "applying" },
      });
      if (claim.count === 0) {
        const cur = await db.autoskillProposal.findUnique({
          where: { id },
          select: { userId: true, status: true },
        });
        if (!cur) return Response.json({ error: "not_found" }, { status: 404 });
        if (cur.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
        return Response.json({ error: "already_resolved", status: cur.status }, { status: 409 });
      }
      try {
        await autoskill.applyProposal(id);
      } catch (e) {
        // Roll back the claim so the user can retry.
        await db.autoskillProposal
          .updateMany({
            where: { id, status: "applying" },
            data: { status: "pending" },
          })
          .catch(() => {/* best-effort */});
        const msg = e instanceof Error ? e.message : "apply failed";
        return Response.json({ error: msg }, { status: 422 });
      }
    } else if (body.action === "unreject") {
      // Undo path. Safe to expose because rejecting is a pure status flip —
      // unlike apply, it writes no knowledge rows, so restoring to pending
      // has nothing to unwind. Same compare-and-claim shape as the others,
      // which also makes a double-tapped undo idempotent (second call 409s).
      const claim = await db.autoskillProposal.updateMany({
        where: { id, userId, status: "rejected" },
        data: { status: "pending", resolvedAt: null },
      });
      if (claim.count === 0) {
        const cur = await db.autoskillProposal.findUnique({
          where: { id },
          select: { userId: true, status: true },
        });
        if (!cur) return Response.json({ error: "not_found" }, { status: 404 });
        if (cur.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
        return Response.json({ error: "not_rejected", status: cur.status }, { status: 409 });
      }
    } else {
      // Reject path — same atomic flip.
      const claim = await db.autoskillProposal.updateMany({
        where: { id, userId, status: "pending" },
        data: { status: "rejected", resolvedAt: new Date() },
      });
      if (claim.count === 0) {
        const cur = await db.autoskillProposal.findUnique({
          where: { id },
          select: { userId: true, status: true },
        });
        if (!cur) return Response.json({ error: "not_found" }, { status: 404 });
        if (cur.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
        return Response.json({ error: "already_resolved", status: cur.status }, { status: 409 });
      }
    }

    const updated = await db.autoskillProposal.findUniqueOrThrow({
      where: { id },
    });
    return Response.json({ proposal: toProposalView(updated) });
  } catch (err) {
    return authErrorResponse(err);
  }
}

const patchSchema = z.object({
  reasoning: z.string().min(1).optional(),
  diff: z.string().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const proposal = await db.autoskillProposal.findUnique({ where: { id } });
    if (!proposal) return Response.json({ error: "not_found" }, { status: 404 });
    if (proposal.userId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (proposal.status !== "pending") {
      return Response.json({ error: "already_resolved" }, { status: 409 });
    }

    const updated = await db.autoskillProposal.update({
      where: { id },
      data: {
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        ...(body.diff ? { diff: body.diff } : {}),
      },
    });
    return Response.json({ proposal: toProposalView(updated) });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const proposal = await db.autoskillProposal.findUnique({ where: { id } });
    if (!proposal) return Response.json({ error: "not_found" }, { status: 404 });
    if (proposal.userId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    return Response.json({
      proposal: toProposalView(proposal),
      diff: proposal.diff,
      patch: proposal.patch,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
