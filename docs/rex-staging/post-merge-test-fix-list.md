# Post-Merge Test Fix List

## Goal

Unblock the current post-merge failures with the smallest set of changes.

## Minimal Fix Order

1. Fix the broken production import in `packages/core/cli.js`.
   The file now imports `./assistant-integration.js`, but there is no `packages/core/assistant-integration.js`.
   This is the main cascade failure behind `cli-init`, `cli-start`, `cli-web`, `cli-errors`, `cli-delegation`, `cli-refresh`, and `cli-config`.

2. Finish or revert the assistant integration file move.
   Current state is split:
   - `assistant-integration.js` exists at the repo root.
   - `packages/core/cli.js` expects it inside `packages/core/`.
   - root `assistant-integration.js` imports `./claude-integration.js`, but there is no root `claude-integration.js`.
   Pick one structure and make all imports consistent before touching the wider test suite.

3. Restore the correct Claude integration path in `tests/e2e/architecture-policy.test.js`.
   The allowlist now points at `claude-integration.js`, but the real file is `packages/core/claude-integration.js`.
   This should clear the stale-entry failure and the direct `child_process` allowlist failure.

4. Restore the correct Claude integration path in `tests/e2e/skill-sync.test.js`.
   The failing block reads `ROOT/claude-integration.js`, but the actual file is `packages/core/claude-integration.js`.
   This is a test-path issue, not a runtime behavior issue.

5. Re-run the root e2e suite after steps 1 through 4.
   Do this before changing any other tests.
   Most current failures appear to be secondary fallout from the broken `cli.js` import.

## What Looks Path-Only

- `tests/e2e/architecture-policy.test.js`
- `tests/e2e/skill-sync.test.js`

## What Is Not Path-Only

- `packages/core/cli.js`
- `assistant-integration.js`

These are production-path problems, not just broken test references.

## Suggested Verification

```sh
pnpm exec vitest run tests/e2e/architecture-policy.test.js tests/e2e/skill-sync.test.js tests/e2e/cli-init.test.js
pnpm exec vitest run tests/e2e
```

## Notes

- `pnpm build` currently passes.
- `pnpm install` in a non-TTY shell aborts with pnpm's modules-dir confirmation, so that is separate from the merge regression.
