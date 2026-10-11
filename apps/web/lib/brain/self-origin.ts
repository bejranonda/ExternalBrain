/**
 * Origin a server action uses to call this app's own API routes.
 *
 * Loopback, not `AUTH_URL`: the public URL makes the container call itself
 * back out through the reverse proxy — needing self-egress and split-horizon
 * DNS, both of which a locked-down host commonly denies — and the proxy then
 * stamps the web container's own address as the client IP, so every visitor
 * lands in one rate-limit bucket. `INTERNAL_SELF_ORIGIN` is the escape hatch
 * if a deployment ever puts the route handlers somewhere else.
 */
export function selfOrigin(): string {
  return (
    process.env.INTERNAL_SELF_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || "3000"}`
  );
}
