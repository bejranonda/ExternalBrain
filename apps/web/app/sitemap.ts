import type { MetadataRoute } from "next";

// Force per-request rendering — sitemap reads BRAIN_PUBLIC_HOSTNAME and
// would otherwise get the dummy-env value baked in at Docker build time.
// See GUIDELINES §10 + ExternalBrain #7.
export const dynamic = "force-dynamic";

// Closes ExternalBrain #8 sibling — gave /sitemap.xml a real text/xml
// response instead of the HTML 404 fallthrough. Lists only the
// unauthenticated public surfaces; authenticated routes (Skills,
// Sessions, Oracle, Settings) intentionally absent — they require a
// valid session and listing them invites credential-stuffing probes.
//
// When BRAIN_ROBOTS_DISALLOW_ALL is the default (true), this sitemap
// is essentially advisory: robots.ts tells crawlers to stay out, and
// this list tells the operator + any allowed crawler what's actually
// safe to look at.
export default function sitemap(): MetadataRoute.Sitemap {
  const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim() || "localhost:3000";
  const proto = host === "localhost:3000" ? "http" : "https";
  const base = `${proto}://${host}`;
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/welcome`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/signin`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/forgot-password`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
  ];
}
