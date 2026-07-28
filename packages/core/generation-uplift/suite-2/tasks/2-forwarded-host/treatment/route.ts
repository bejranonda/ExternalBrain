import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();

  // Inside the container the request is plain HTTP on an internal host, so
  // req.url/req.nextUrl would build an absolute URL pointing at the container
  // rather than the public origin. Only the proxy's forwarded headers know it.
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();

  const proto = forwardedProto || "https";
  const host = forwardedHost || h.get("host");

  if (!host) {
    return NextResponse.redirect("/new", 308);
  }

  return NextResponse.redirect(`${proto}://${host}/new`, 308);
}
