/**
 * Prompt text a user pastes into their AI agent so the agent performs its
 * own setup, rather than the user running commands by hand. Two variants
 * share this file because they share the same *shape* (name the resource,
 * point at exactly one URL, bound what the agent may do) even though the
 * resource differs — a voucher code pre-auth, or an already-minted token
 * post-auth. Kept out of any single page component so both /start and
 * /settings/tokens read from the same source instead of drifting.
 */

/**
 * The prompt for a brand-new user with a voucher code and no account yet.
 * Every word is doing work:
 *  - names the voucher explicitly so the agent doesn't have to infer it
 *  - points at one URL and says "follow it", bounding what the agent may do
 *  - says "ask me for my email" so the agent doesn't invent one, which is the
 *    single most damaging thing it could improvise here
 *
 * `voucher` must already be through `sanitizeVoucherInput`.
 */
export function buildVoucherAgentPrompt(webUrl: string, voucher: string): string {
  return [
    `Set up External Brain on this machine. My voucher code is ${voucher}.`,
    `Fetch ${webUrl.replace(/\/$/, "")}/api/onboard/agent.md and follow it exactly.`,
    `Ask me for my email address first — don't guess it.`,
  ].join("\n");
}

/**
 * The prompt for a user who already has an account and just minted a token
 * at /settings/tokens — no voucher, no claim step. Points the agent at the
 * `mode=token` bootstrap doc (renderBrainBootstrapForToken) instead of the
 * voucher one.
 *
 * `rawToken` is shown once at mint time and cannot be retrieved again — the
 * same value the manual install wizard already displays, just presented as
 * a prompt instead of a command.
 */
export function buildTokenAgentPrompt(webUrl: string, rawToken: string): string {
  return [
    `Connect this machine to External Brain. I already have an account and a token.`,
    `Fetch ${webUrl.replace(/\/$/, "")}/api/onboard/agent.md?mode=token and follow it exactly.`,
    `My token is: ${rawToken}`,
  ].join("\n");
}
