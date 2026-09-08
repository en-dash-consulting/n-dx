---
"@n-dx/web": patch
---

Guard the `NDX_CLI_PATH` rung of the ndx binary ladder, and document it.

`resolveNdxBin` had an undocumented first rung — `NDX_CLI_PATH` returned
verbatim, above every rung its doc comment described, and without the
`existsSync` check its twin `N_DX_CLI_PATH` has. Two names for one fact:
`packages/core/cli.js` assigns both to its own path on startup, so a server
started by `ndx start` carries both.

- **Both env rungs are now guarded.** The value is exported to every child of an
  `ndx` process, so it outlives the install that wrote it. A dev-link install
  that moved or was uninstalled left a path that no longer exists, and rung 1
  spawned it anyway — `node <missing file>`, where the rungs below it would have
  resolved.
- **The ladder is documented as five rungs**, including why there are two env
  names and that the launcher currently outranks the analyzed project's own
  `node_modules/.bin/ndx`. The prose ladder in `routes-hench.ts` named only
  `NDX_CLI_PATH`; the doc comment named only `N_DX_CLI_PATH`. Neither was
  complete.

The ladder tests now cover rung 1 — that it beats both the project-local bin and
`N_DX_CLI_PATH`, and that a stale value falls through. An ambient `NDX_CLI_PATH`
answering silently from rung 1 is what left the rungs below it asserting nothing,
which is how the unguarded return stayed invisible: the suite was red for anyone
running it from a session `ndx` had launched, and green in CI, which sets neither
name.
