/**
 * /admin/org — permanently moved to /settings/org.
 *
 * Org owners who are not platform admins were blocked by the /admin/* layout gate.
 * The page is now at /settings/org (no admin gate — just requires sign-in + org membership).
 */
import { redirect } from "next/navigation";

export default function AdminOrgRedirect() {
  redirect("/settings/org");
}
