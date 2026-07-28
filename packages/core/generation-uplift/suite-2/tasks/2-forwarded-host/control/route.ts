import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// Inside the container the app is reached over plain HTTP on an internal
// hostname, so `request.url` yields e.g. http://localhost:3000 — never the
// public origin. The TLS-terminating proxy is the only source of truth for the
// externally visible scheme/host, so read its X-Forwarded-* headers. These are
// trustworthy only because every request is forced through that proxy.
function externalOrigin(request: NextRequest): string {
  const headers = request.headers;

  // A proxy chain appends to these, so the client-most value is first.
  const forwardedHost =
    first(headers.get('x-forwarded-host')) ?? headers.get('host');
  const forwardedProto = first(headers.get('x-forwarded-proto'));

  if (!forwardedHost) {
    return request.nextUrl.origin;
  }

  const proto = forwardedProto ?? request.nextUrl.protocol.replace(':', '');
  return `${proto}://${forwardedHost}`;
}

function first(value: string | null): string | null {
  if (!value) return null;
  const head = value.split(',')[0]?.trim();
  return head ? head : null;
}

export function GET(request: NextRequest): NextResponse {
  const target = new URL('/new', externalOrigin(request));
  target.search = request.nextUrl.search;

  return NextResponse.redirect(target, 308);
}
