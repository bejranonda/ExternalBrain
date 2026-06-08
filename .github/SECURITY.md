# Security policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **[Report a vulnerability](https://github.com/bejranonda/ExternalBrain/security/advisories/new)**
(Security → Advisories), which opens a private channel with the maintainers.
Include repro steps and the affected surface (webapp page, MCP method, REST
endpoint, deploy script). Please redact any tokens or client data.

We aim to acknowledge reports within a few days and will coordinate a fix and
disclosure timeline with you.

## Scope & hardening model

External Brain is **secure-by-default**: a freshly-deployed instance is locked
until an auth mode is chosen, and MCP requires Bearer auth on every method
(including `initialize`). The detailed threat model, auth modes, and the
pre-release lockdown audit are documented in
**[`docs/SECURITY.md`](../docs/SECURITY.md)**; run `./scripts/verify-lockdown.sh`
against any deployment to check its posture.

## Supported versions

This is a self-hostable project that ships from `main`. Security fixes land on
`main` and are included in the next tagged release; run a recent build.
