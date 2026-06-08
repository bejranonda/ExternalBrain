# Contributing to External Brain

The full contributor guide lives in **[`docs/CONTRIBUTING.md`](../docs/CONTRIBUTING.md)**
(and the AI-agent / architecture orientation in [`AGENTS.md`](../AGENTS.md)).

Quick version:

1. **Fork** and branch from `main`: `feature/<slug>`, `bugfix/<slug>`, or `docs/<slug>`.
2. Keep **one logical change per PR**.
3. Run the gates locally (CI re-runs them as the hard gate):
   ```bash
   pnpm turbo run typecheck
   pnpm turbo run test
   pnpm turbo run build
   ```
4. Open a PR with an **honest test plan** — checks you actually performed, plus
   unchecked boxes for what a reviewer should verify.

See [`docs/GUIDELINES.md`](../docs/GUIDELINES.md) for code style and package
boundaries, and [`docs/QUICKSTART.md`](../docs/QUICKSTART.md) to run your own
instance.
