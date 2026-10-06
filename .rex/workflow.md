This codebase will outlive you. Every shortcut you take becomes someone else's burden.
Fight entropy. Leave the codebase better than you found it. Use as few words as is necessary
to describe changes, and thoughts.

## n-dx repo rules

Validate with scoped commands. Do not run the whole repository suite.

- Package test file: `pnpm --filter @n-dx/<pkg> exec vitest run <file>`
- Package suite: `pnpm --filter @n-dx/<pkg> exec vitest run`
- Root test file: `node_modules/.bin/vitest run tests/<path>`
- Build only what you changed: `pnpm --filter @n-dx/<pkg> build`. Root e2e tests spawn built CLIs, so rebuild a changed package before running them.
- Do not prefix commands with `cd … &&`; use `--filter`.

Cost: one full pass (`pnpm test`, `run-all-tests.mjs`) takes ~9 min quiet, ~14 min loaded; the root suite alone 2.5–6 min. hench's gate runs the affected suites after you finish, and CI runs everything on three OSes. Widen only when a scoped failure needs it.

Pre-existing failures unrelated to your change: log them and continue. Do not fix them in this task.
