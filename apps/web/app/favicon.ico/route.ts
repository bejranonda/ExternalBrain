// Some older browsers + scrapers request /favicon.ico unconditionally,
// ignoring the <link rel="icon" href="/icon.svg"> Next.js auto-injects.
//
// We can't use NextResponse.redirect(new URL(..., req.url)) because
// req.url inside the container is the internal upstream (0.0.0.0:3000)
// — the public proxy host is in X-Forwarded-Host. Easiest fix: emit a
// 308 with a path-only Location header. Per RFC 7231 §7.1.2 a Location
// header can be relative; browsers resolve it against the request URL.
export function GET() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/icon.svg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
