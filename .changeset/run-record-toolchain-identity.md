---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Record which n-dx produced each hench run.

Several checkouts are usually live at once — a worktree per in-flight PR plus a
linked global install — and their run records were indistinguishable, so a token
or outcome report could not say which build the numbers came from.

`RunRecord` gains two optional fields, stamped at run start by `initRunRecord`
and by `hench record`:

- `ndxVersion` — `NDX_VERSION` when an orchestrator exports it, otherwise the
  `@n-dx/hench` manifest version.
- `cliPath` — `NDX_CLI_PATH` / `N_DX_CLI_PATH` (exported by `packages/core/cli.js`),
  falling back to `process.argv[1]`.

Both are additive: records written before the fields existed load unchanged, and
the dashboard's run detail renders each row only when its value is present. A
failed manifest read is not memoized, so one transient error cannot pin every
later run in the process to a missing version.
