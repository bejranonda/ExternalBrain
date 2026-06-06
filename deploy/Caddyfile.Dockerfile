# syntax=docker/dockerfile:1.7
#
# Caddy with the mholt/caddy-ratelimit plugin — the prod `Caddyfile` uses
# the `rate_limit` directive (per-IP edge throttling), which is NOT in the
# stock `caddy:2-alpine` image. Without this build, any new prod host
# wired through Caddy fails config-load on startup.
#
# Audit C14 (#110): the previous setup pulled `caddy:2-alpine` directly,
# leaving `rate_limit` as a latent landmine. This Dockerfile pins the
# plugin into the image at build time via xcaddy.
#
# Build: docker build -f deploy/Caddyfile.Dockerfile -t brain/caddy:2 .
# Used by: the `caddy` service (edge profile) in deploy/docker-compose.yml.
#
# Plugin pin: a specific tag is preferred to a moveable ref so a future
# upstream change can't break our config silently. Update by bumping the
# tag and rebuilding.

FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
