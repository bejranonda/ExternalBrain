import { WelcomeFlow } from "@/components/brain/welcome-flow";
import { LocalePicker } from "@/components/brain/locale-picker";
import { auth } from "@/auth";

export const metadata = {
  title: "Welcome — External Brain",
  description:
    "Check that your Brain is connected and learning from your first session.",
};

/**
 * Force SSR at request time — this page reads the session to decide whether
 * to poll /api/dashboard (#33).
 *
 * The public-URL resolution that used to live here (resolvePublicMcpUrl /
 * resolvePublicWebUrl, #293) was removed 2026-08-09 along with the install
 * snippet this page no longer renders. The quick-start tutorial it now links
 * to is the one place that shows install commands, and it resolves its own
 * URLs — so there is no longer a second surface that can drift from the
 * first, which was the whole #293 defect class.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  // Anonymous visitors (this is a public page) shouldn't poll /api/dashboard
  // — it 401s and the browser logs it. Resolve auth state server-side and let
  // WelcomeFlow gate the poll on it. #33.
  const session = await auth();
  return (
    <>
      <LocalePicker />
      <WelcomeFlow authed={!!session?.user} />
    </>
  );
}
