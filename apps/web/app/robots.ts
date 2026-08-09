import type { MetadataRoute } from "next";
import { envFlag } from "@brain/core/env";

// Force per-request rendering — see GUIDELINES §10 "Server-component env
// vars need force-dynamic". The Dockerfile builds with dummy env, so any
// build-time read of process.env.BRAIN_ROBOTS_DISALLOW_ALL would freeze
// the empty value (which happens to be safe here, but the rule applies
// for consistency).
export const dynamic = "force-dynamic";

// Closes ExternalBrain #8 — previously /robots.txt fell through to the
// app's not-found page (HTML 13 kB), which polite crawlers treat as a
// junk response. Brain is invite-only by default, so the safe posture
// is Disallow: /. Operators with a public landing can flip
// BRAIN_ROBOTS_DISALLOW_ALL=false to allow non-/api crawl.
//
// Reads env at request time — see GUIDELINES §10 "Server-component env
// vars need force-dynamic" — but a robots.ts is request-scoped by Next
// (not statically rendered) so the directive isn't needed here.
export default function robots(): MetadataRoute.Robots {
  const disallowAll = envFlag("BRAIN_ROBOTS_DISALLOW_ALL", true);
  return {
    rules: [
      {
        userAgent: "*",
        disallow: disallowAll ? "/" : "/api/",
      },
    ],
  };
}
