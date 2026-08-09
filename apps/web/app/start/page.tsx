import { StartFlow } from "@/components/brain/start-flow";
import { LocalePicker } from "@/components/brain/locale-picker";
import { publicUrlsFromEnv } from "@/lib/brain/skill-template";
import { agenticOnboardingEnabled } from "@/lib/brain/agentic-onboarding";

export const metadata = {
  title: "Set up your Brain — External Brain",
  description:
    "Redeem a voucher code: let your AI agent do the setup, or create an account in the browser.",
};

// Same reason as /welcome: the Dockerfile builds with dummy env vars, so any
// page reading BRAIN_*_PUBLIC_HOSTNAME must render at request time or it gets
// pre-rendered with an empty host and shows the wrong URL forever.
export const dynamic = "force-dynamic";

/**
 * /start — public. Deliberately no auth check: the entire audience is people
 * who do not have an account yet. It is the canonical URL printed on voucher
 * cards, mailed with codes, and linked from every voucher error on /signin.
 */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ voucher?: string }>;
}) {
  const { voucher } = await searchParams;
  // Same resolver the /api/onboard/agent.md route uses, so the URL printed in
  // the paste-prompt and the URL the agent actually fetches agree by
  // construction. `resolvePublicWebUrl()` would have been the local habit, but
  // it returns undefined when BRAIN_PUBLIC_HOSTNAME is unset — and a prompt
  // containing an empty origin is worse than one containing localhost.
  const { webUrl } = publicUrlsFromEnv();
  return (
    <>
      <LocalePicker />
      <StartFlow
        webUrl={webUrl}
        agenticEnabled={agenticOnboardingEnabled()}
        {...(voucher ? { initialVoucher: voucher } : {})}
      />
    </>
  );
}
