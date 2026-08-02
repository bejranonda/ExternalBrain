import { redirect } from "next/navigation";

/**
 * `/settings` index.
 *
 * The settings section had a layout and an error boundary but no page of its
 * own, so trimming the URL — or following any doc that says "go to Settings" —
 * hit not-found. Tokens is the first thing a new user needs there, and it is
 * already where the empty-state CTAs point.
 */
export default function SettingsIndex() {
  redirect("/settings/tokens");
}
