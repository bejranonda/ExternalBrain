import { z } from "zod";
import { db } from "@brain/db";
import type { ToolDef } from "./index.js";

/**
 * brain_whoami — "which Brain am I actually talking to, as whom, holding what?"
 *
 * Exists because of KNOWN_ISSUES §0t. An agent taught six rules over MCP,
 * verified the loop end-to-end, and every call returned a real knowledge id —
 * against the wrong instance. The client had bound its endpoint at session
 * start and was still talking to the previous Brain; `~/.claude.json` said
 * something else. Nothing errored.
 *
 * The only conclusive diagnosis available at the time was a SELECT against
 * Postgres, which a self-hoster on a managed host and every non-admin user
 * cannot run — i.e. exactly the people it fails for. A failure diagnosable
 * only from the server is undiagnosable where it occurs.
 *
 * So this returns the three facts that distinguish instances, in one call:
 *
 *   instance      — the public identity of THIS deployment
 *   identity      — which user/token the presented bearer resolves to
 *   knowledgeHeld — counts, so "0 reflexes" can be read as "fresh instance"
 *                   or "wrong instance" instead of "something is broken"
 *
 * Deliberately carries NO argument. A diagnostic you must configure is one
 * more thing that can be configured wrongly.
 *
 * Returns no secret material: the token is identified by name and id, never
 * by value or hash — the hash is what the database stores, and echoing it
 * back over the wire would hand an attacker the lookup key.
 */
const inputShape = z.object({}).strict();

export const whoami: ToolDef = {
  name: "brain_whoami",
  description:
    "Identify which Brain instance this connection reaches, which user/token the bearer resolves to, and how much knowledge that user holds. Call it when a teach appears to succeed but the data never shows up, when brain_get_user_style returns nothing, or after repointing a client at a different Brain — an MCP client binds its endpoint at session start, so the config file on disk is NOT proof of the live target.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (raw, auth) => {
    inputShape.parse(raw ?? {});

    const [user, token, knowledgeCount, sessionCount] = await Promise.all([
      db.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, email: true, name: true },
      }),
      auth.tokenId
        ? db.mCPToken.findUnique({
            where: { id: auth.tokenId },
            select: { id: true, name: true, projectId: true },
          })
        : Promise.resolve(null),
      db.knowledge.count({
        where: { ownerUserId: auth.userId, deletedAt: null },
      }),
      db.session.count({ where: { userId: auth.userId } }),
    ]);

    // The public hostname this deployment believes it serves. Reading it from
    // the server's own env (not from anything the client sent) is the point:
    // it is the fact the client cannot know and cannot get wrong.
    //
    // The `|| BRAIN_PUBLIC_HOSTNAME` fallback is deliberately NOT silent any
    // more. On the reference deployment the MCP var was never passed to this
    // container, so the fallback fired and this tool — whose entire job is
    // answering "which Brain am I talking to?" — confidently reported the
    // WEB host (`brain.autobahn.bot`) for an endpoint actually served at
    // `mcp.brain.autobahn.bot` (`KNOWN_ISSUES §0ax`). A diagnostic that
    // guesses is worse than one that admits it does not know, because the
    // guess is indistinguishable from the answer.
    const mcpHost = process.env.BRAIN_MCP_PUBLIC_HOSTNAME?.trim() || null;
    const webHost = process.env.BRAIN_PUBLIC_HOSTNAME?.trim() || null;

    return {
      instance: {
        mcpPublicHostname: mcpHost ?? webHost,
        // Present ONLY when the value above is a fallback, so a reader can
        // tell a known answer from a plausible one.
        ...(mcpHost
          ? {}
          : {
              mcpPublicHostnameIsFallback: true,
              mcpPublicHostnameNote:
                "BRAIN_MCP_PUBLIC_HOSTNAME is not set on this server; the value shown is the WEB hostname and is probably not the MCP endpoint you connected to.",
            }),
        // Distinguishes two deployments that share a hostname but not a
        // database — a staging copy restored from a prod dump, say.
        databaseName: process.env.POSTGRES_DB ?? "brain",
        // BRAIN_DEPLOY_ENV, never ENVIRONMENT. The reference prod host carries
        // `ENVIRONMENT=dev` as a leftover label, so the old read here would
        // have reported a production Brain as "dev" — the precise failure
        // `apps/web/app/api/healthz/route.ts` was given a separate variable to
        // avoid, reproduced in the tool meant to catch it (`§0al`, `§0ax`).
        // Absent rather than guessed when unset: "cannot verify" ≠ "not prod".
        environment: process.env.BRAIN_DEPLOY_ENV?.trim() || null,
      },
      identity: {
        userId: user?.id ?? auth.userId,
        email: user?.email ?? null,
        name: user?.name ?? null,
        tokenId: token?.id ?? null,
        tokenName: token?.name ?? null,
        tokenProjectId: token?.projectId ?? null,
        tokenIsProjectScoped: auth.projectId !== null,
        // capability.ts's error text notes that "the token's capability list
        // is not visible from the client side" — so a caller hitting
        // FORBIDDEN_CAPABILITY had to guess. It is visible here. Empty means
        // unrestricted, matching the stored contract.
        capabilities: auth.capabilities,
        capabilitiesMeaning:
          auth.capabilities.length === 0
            ? "unrestricted"
            : "restricted to the listed capabilities",
      },
      knowledgeHeld: {
        // An empty Brain and the wrong Brain look identical from the client
        // until you can see these two numbers alongside the instance above.
        knowledge: knowledgeCount,
        sessions: sessionCount,
      },
    };
  },
};
