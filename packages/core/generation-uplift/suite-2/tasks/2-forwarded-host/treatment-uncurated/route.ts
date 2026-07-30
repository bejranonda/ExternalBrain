import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();

  // Behind the TLS-terminating proxy the container only ever sees plain HTTP on
  // an internal hostname, so req.url would leak e.g. http://localhost:3000.
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host");

  const location = `${proto}://${host}/new`;

  return new Response(null, {
    status: 308,
    headers: { Location: location },
  });
}
