---
id: "0fd8c9d9-40f7-4317-991b-cd5dd6f91166"
level: "epic"
title: "Fix · #511 rex add and update cannot set acceptance criteria or source"
status: "pending"
priority: "high"
tags:
  - "fix"
  - "rex"
  - "cli"
source: "ndx-capture"
acceptanceCriteria:
  - "`rex add task --title=... --parent=<id> --criterion=\"A\" --criterion=\"B\" --source=ndx-capture` writes an item whose acceptanceCriteria is [\"A\", \"B\"] and whose source is ndx-capture."
  - "`rex update <id> --criterion=\"C\"` replaces the item's criteria with [\"C\"]; `rex update <id> --criterion=` clears them; `rex update <id> --source=...` sets source."
  - "`rex add --help` and `rex update --help` list --criterion and --source with one example each."
  - "Existing `rex add` / `rex update` invocations without the new flags behave exactly as before."
  - "A patch changeset for @n-dx/rex references #511."
description: "Fixes en-dash-consulting/n-dx#511.\n\nProblem: `rex add <level> --title=...` writes `acceptanceCriteria: []` and has no flag for criteria or `source`. `rex update` can change status, priority, title, description, blockedBy and run, but not acceptance criteria or source. MCP `add_item` and `edit_item` already take `acceptanceCriteria: string[]` and `source`. Without the MCP server, an agent following `/ndx-capture` has to fold numbered criteria into `--description`, which loses the structured field that `verify_criteria`, the dashboard requirements view and the hench brief read.\n\nShape (from the issue, matching MCP add_item / edit_item):\n- `rex add`: repeatable `--criterion=\"...\"`, one criterion per flag, plus `--source=\"...\"`.\n- `rex update`: the same `--criterion` flag replaces the whole list; `--criterion=` on its own clears it. `--source=\"...\"` sets source.\n- Both help texts list the flags and give one example.\n\nWhere the code is:\n- Flag parsing: `packages/rex/src/cli/index.ts` — `MULTI_VALUE_KEYS` (today only `file`) and `VALUE_KEYS`; `parseArgs` already collects repeated multi-value keys into `multiFlags`. `dispatchAdd` sends manual mode to `cmdAdd(dir, level, flags)` and the `update` case calls `cmdUpdate(dir, id, flags)` — neither receives `multiFlags` today.\n- `packages/rex/src/cli/commands/add.ts` (`cmdAdd`, item built around line 155) and `packages/rex/src/cli/commands/update.ts` (`cmdUpdate`, `updates` built from flags).\n- Help: `packages/rex/src/cli/help.ts`, the `add` and `update` entries.\n- Reference implementation of the semantics: `packages/rex/src/cli/mcp-tools/add-item.ts` and `edit-item.ts`.\n\nOut of scope: `--tags` and `--run` on `rex add` (MCP add_item has both, CLI add has neither) — note as a possible follow-up, do not implement. The `/ndx-capture` skill text is not changed in this epic (its generated copy lives under `.claude/`, which hench runs cannot write).\n\nConventions (every task in this epic):\n- Branch: fix/511-cli-acceptance-criteria (this worktree), from main. One PR for the whole epic.\n- Run scoped tests while you work: `pnpm --filter @n-dx/rex exec vitest run <file>` and the rex package suite; root tests with `node_modules/.bin/vitest run tests/e2e/<file>`. hench runs the full suite as its gate after you finish, so do not run `pnpm test` or `node scripts/run-all-tests.mjs` yourself.\n- Before you finish, run the root policy tests: `node_modules/.bin/vitest run tests/e2e/architecture-policy.test.js tests/e2e/domain-isolation.test.js tests/e2e/shell-spawn-inventory-policy.test.js tests/e2e/wall-clock-inventory-policy.test.js tests/e2e/layout-literal-policy.test.js tests/e2e/obfuscated-code-policy.test.js`.\n- Build rex after changing it (`pnpm --filter @n-dx/rex build`). Root e2e tests spawn the built CLI, so a stale dist fails the gate.\n- Do not prefix commands with `cd … &&`; use `--filter` or `--root`.\n- The gate runs with NDX_CLI_PATH set. Run any env-dependent test you add with `env -u NDX_CLI_PATH` as well.\n- One patch changeset with the scoped name `@n-dx/rex`, written in the last task only."
lastModified: "2026-10-08T18:22:50.499Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [rex add takes repeatable --criterion and --source in manual mode](./rex-add-takes-repeatable-criterion-and.md) | pending |
| [rex update replaces or clears acceptance criteria with --criterion and sets --source](./rex-update-replaces-or-clears.md) | pending |
| [Document rex add/update --criterion and --source and add the @n-dx/rex changeset](./document-rex-add-update-criterion-and.md) | pending |
