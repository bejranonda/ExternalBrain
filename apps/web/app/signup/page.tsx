import { redirect } from "next/navigation";

/**
 * `/signup` → the real registration form, which is a mode of `/signin`.
 *
 * `/signup` is the URL people guess and the one onboarding emails tend to
 * carry; without this it was a 404. Kept as a redirect rather than a second
 * copy of the form so there is still exactly one place the voucher gate,
 * password policy and error copy live.
 */
export default function SignUp() {
  redirect("/signin?mode=register");
}
