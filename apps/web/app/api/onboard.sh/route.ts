/**
 * GET /api/onboard.sh  →  POSIX bash installer (macOS / Linux / WSL / Git Bash).
 *
 * Public, unauthenticated. The installer takes the bearer as $1 at run
 * time, so this URL contains no per-user secrets and can be cached freely.
 */
import { NextResponse } from "next/server";
import { bashInstaller } from "@/lib/brain/installer-templates";
import { publicUrlsFromEnv } from "@/lib/brain/skill-template";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const body = bashInstaller(publicUrlsFromEnv());
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "content-disposition": 'inline; filename="brain-install.sh"',
    },
  });
}
