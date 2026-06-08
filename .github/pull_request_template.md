<!-- Thanks for contributing to External Brain! Keep one logical change per PR. -->

## What & why
<!-- What does this change do, and why? Link issues: "Closes #123". -->

## Test plan
<!-- A test plan is a contract, not a wish-list (see AGENTS.md §"Honest test plans"). -->
- [ ] <!-- a check you ACTUALLY performed — be specific -->
- [ ] <!-- ... -->

<!-- List checks a REVIEWER should perform as unchecked boxes. If you couldn't
     run something, say so ("relying on CI") rather than implying you did. -->

## Gates
- [ ] `pnpm turbo run typecheck` (or relying on CI)
- [ ] `pnpm turbo run test`
- [ ] `pnpm turbo run build`
- [ ] Ran `./scripts/verify-lockdown.sh` if this touches auth / MCP gating
