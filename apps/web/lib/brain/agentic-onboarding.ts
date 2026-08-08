/**
 * Policy for the anonymous voucher → MCP-token exchange (`/api/onboard/claim`).
 *
 * This module holds the *decisions*; the route holds the plumbing. Keeping
 * them apart is what lets `agentic-onboarding.test.ts` assert the security
 * posture (gate default, TTL, capability set) with no database and no HTTP —
 * the `public-urls.test.ts` precedent for this repo's recurring defect class.
 *
 * The exchange hands a working bearer to a caller who only proved they hold a
 * voucher code. That makes the voucher a bearer-equivalent secret, and every
 * constant below follows from that one fact.
 */
import {
  clientById,
  type ClientId,
  type TargetOS,
} from "@brain/core/install-snippets";
import type { Capability } from "@brain/core";

/**
 * Master switch, default OFF.
 *
 * Hard rule 2 in AGENTS.md: the platform is secure-by-default and a freshly
 * deployed instance is locked until the operator picks a posture. An endpoint
 * that vends bearers to anyone holding a voucher is exactly the kind of thing
 * that must not appear on a `docker compose up` a maintainer hasn't finished
 * configuring. Mirrors `registrationRequiresVoucher()`'s string handling, but
 * inverted: only the literal "true" opens it.
 */
export function agenticOnboardingEnabled(): boolean {
  return (process.env.AGENTIC_ONBOARDING ?? "false").toLowerCase() === "true";
}

/**
 * 14 days, against the 90-day default for a hand-minted token
 * (`/api/tokens`'s DEFAULT_TTL_DAYS).
 *
 * Two reasons, both about blast radius rather than hygiene. A voucher travels
 * through chat prompts and screenshares, so a leaked one should not buy a
 * quarter of access. And the bearer necessarily appears in the agent's
 * transcript — it is inside `installCommand` — which means it also lands in
 * the harness's on-disk session log. Pilot-length, then the user mints a real
 * one from /settings/tokens.
 */
export const BOOTSTRAP_TOKEN_TTL_DAYS = 14;

/**
 * The bootstrap token is scoped; `/api/tokens` defaults to unrestricted.
 *
 * `oracle` is deliberately absent. It is the one billed capability
 * ($0.01–$0.10 per call against the operator's provider account, tracked in
 * the admin cost ledger), so a headless mint would turn a leaked voucher into
 * direct billing exposure. Excluding it also gives claiming the web login a
 * concrete payoff.
 *
 * The cost: a user's first `brain_ask_oracle` returns 403, which can read as
 * "broken" rather than "scoped". Both `/start` and the claim response say so
 * in words, which is cheaper than a per-token spend ceiling. If that ceiling
 * ever ships, `oracle` belongs back in this list.
 */
export const BOOTSTRAP_TOKEN_CAPABILITIES: readonly Capability[] = [
  "knowledge",
  "skills",
  "sessions",
];

/** Name shown in the user's token list so the origin is obvious later. */
export const BOOTSTRAP_TOKEN_NAME = "Agentic onboarding";

/** Fallbacks when the agent doesn't declare its client / platform. */
export const DEFAULT_BOOTSTRAP_CLIENT: ClientId = "claude-code";
export const DEFAULT_BOOTSTRAP_OS: TargetOS = "linux";

export interface BootstrapInstall {
  client: ClientId;
  os: TargetOS;
  /**
   * The one-liner to run, or `null` for the two clients that have no runnable
   * installer: `jetbrains` (config is edited through the IDE's settings UI)
   * and `rest` (not an MCP client at all — raw HTTP calls). `InstallSnippet`
   * types `command` as optional precisely because of those two, and a
   * non-null assertion here would have crashed the exchange for them at
   * runtime after type-checking clean.
   */
  command: string | null;
  /** Always populated: the config or calls to apply when `command` is null. */
  manualLines: string[];
  note?: string;
}

/**
 * The install command, resolved from the client registry rather than
 * assembled here.
 *
 * This function is the single source for every surface that shows an install
 * command in an agentic context. Building the `curl … | bash` string locally
 * would have been three lines and would have reproduced KNOWN_ISSUES §0c
 * exactly: one value rendered by several surfaces, corrected in some of them.
 * `install-command-single-source.test.ts` asserts it stays that way.
 */
export function bootstrapInstallCommand(opts: {
  token: string;
  mcpUrl: string;
  webUrl: string;
  client?: ClientId;
  os?: TargetOS;
}): BootstrapInstall {
  const client = opts.client ?? DEFAULT_BOOTSTRAP_CLIENT;
  const os = opts.os ?? DEFAULT_BOOTSTRAP_OS;
  const descriptor = clientById(client) ?? clientById(DEFAULT_BOOTSTRAP_CLIENT)!;
  const snippet = descriptor.snippet(opts.token, opts.mcpUrl, opts.webUrl, os);
  return {
    client: descriptor.id,
    os,
    command: snippet.command ? snippet.command.lines.join("\n") : null,
    manualLines: snippet.lines,
    ...(snippet.note ? { note: snippet.note } : {}),
  };
}

/**
 * Where the human claims web access.
 *
 * The exchange creates a User with no UserCredential on purpose — an agent
 * must never invent a password, because it would land in the transcript and
 * the user would never learn it. `forgot-password` is the existing,
 * email-verified way to set the first one; nothing new is needed.
 */
export function setPasswordUrl(webUrl: string, email: string): string {
  return `${webUrl.replace(/\/$/, "")}/forgot-password?email=${encodeURIComponent(email)}`;
}

/** Canonical public front door — printed on voucher cards, linked from errors. */
export function startUrl(webUrl: string): string {
  return `${webUrl.replace(/\/$/, "")}/start`;
}
