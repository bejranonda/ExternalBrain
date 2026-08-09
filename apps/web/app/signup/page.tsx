import { redirect } from "next/navigation";

/**
 * `/signup` → the real registration form, which is a mode of `/signin`.
 *
 * `/signup` is the URL people guess and the one onboarding emails tend to
 * carry; without this it was a 404. Kept as a redirect rather than a second
 * copy of the form so there is still exactly one place the voucher gate,
 * password policy and error copy live.
 *
 * The redirect FORWARDS the voucher (2026-08-09). It previously hardcoded
 * `/signin?mode=register`, silently dropping every query param — so `/start`
 * sent people here with `?voucher=CODE` after they had already typed it, and
 * they were asked to type it again on arrival. A redirect that loses the one
 * piece of state the previous page collected is worse than no redirect.
 * Only `voucher` is forwarded, not the whole query string: this is an
 * unauthenticated entry point, and blindly replaying arbitrary params into
 * an auth surface is how open-redirect and param-injection bugs start.
 */
export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ voucher?: string }>;
}) {
  const { voucher } = await searchParams;
  redirect(
    voucher
      ? `/signin?mode=register&voucher=${encodeURIComponent(voucher)}`
      : "/signin?mode=register",
  );
}
