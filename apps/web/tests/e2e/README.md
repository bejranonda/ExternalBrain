# E2E tests (Playwright)

Roadmap-3 e2e suite — covers the 5 highest-trafficked surfaces:
sign-in, dashboard, Oracle, sessions, skills.

These specs target a **deployed brain** (default
`https://brain-dev.example.com`) and require an authenticated session
cookie, in contrast to the legacy `apps/web/e2e/` suite which expects a
locally running stack.

## Run locally

```bash
# Install playwright browsers first time:
pnpm --filter @brain/web exec playwright install chromium

# Grab a session cookie from devtools on the deployed brain
# (Application -> Cookies -> the __Secure-authjs.session-token entry):
export E2E_AUTH_COOKIE='__Secure-authjs.session-token=eyJ...'

# Run all roadmap-3 specs (default targets brain-dev.example.com):
pnpm --filter @brain/web exec playwright test tests/e2e

# Single spec:
pnpm --filter @brain/web exec playwright test tests/e2e/oracle.spec.ts

# Against a local dev brain:
E2E_BASE_URL=http://localhost:3000 \
  pnpm --filter @brain/web exec playwright test tests/e2e
```

## CI integration

**Deferred.** These tests assume access to a deployed brain + an auth
cookie, which CI doesn't have today. Future work: spin up the stack in
CI with docker-compose OR add a service-account login flow.
