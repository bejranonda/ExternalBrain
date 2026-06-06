/**
 * Single source of truth for the running app version in the browser bundle.
 *
 * `NEXT_PUBLIC_APP_VERSION` is inlined at build time (see deploy/Dockerfile's
 * builder stage, fed by the `APP_VERSION` compose build-arg → `git describe`).
 * A plain local `next dev`/`next build` without that arg falls back to "dev",
 * which is honest — a dev build is not a tagged release.
 */
export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev";

/** GitHub releases page for this repo — the version label links here. */
export const RELEASES_URL =
  "https://github.com/bejranonda/ExternalBrain/releases";
