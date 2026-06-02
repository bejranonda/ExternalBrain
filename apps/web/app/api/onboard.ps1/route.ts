/**
 * GET /api/onboard.ps1  →  Windows PowerShell installer.
 *
 * Public, unauthenticated. The installer is a function that takes the
 * bearer as -Token at call time, so this URL contains no per-user secrets.
 */
import { NextResponse } from "next/server";
import { powershellInstaller } from "@/lib/brain/installer-templates";
import { publicUrlsFromEnv } from "@/lib/brain/skill-template";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const body = powershellInstaller(publicUrlsFromEnv());
  return new NextResponse(body, {
    status: 200,
    headers: {
      // Standard MIME for PowerShell.
      "content-type": "application/x-powershell; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "content-disposition": 'inline; filename="brain-install.ps1"',
    },
  });
}
