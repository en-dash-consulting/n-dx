---
id: "673e5666-7ad9-477f-a7e4-63dca792ef36"
level: "task"
title: "rex add takes repeatable --criterion and --source in manual mode"
status: "pending"
priority: "high"
tags:
  - "fix"
  - "rex"
  - "cli"
source: "ndx-capture"
acceptanceCriteria:
  - "`rex add task --title=T --parent=<feature> --criterion=\"A\" --criterion \"B\"` writes acceptanceCriteria [\"A\", \"B\"] to the item's index.md, in that order."
  - "`rex add ... --source=ndx-capture` writes source: ndx-capture on the item."
  - "Empty --criterion values are dropped on add."
  - "`rex add \"some description\" --criterion=A` exits non-zero with an error naming --title, without waiting on stdin."
  - "`rex add --format=json` output includes acceptanceCriteria and source when set."
  - "`rex add --help` lists --criterion and --source and shows an example using them."
  - "A spawn-level test drives the built CLI with two --criterion flags and reads the written item back."
description: "First half of #511. Read the epic description for file locations and conventions.\n\nChanges:\n1. `packages/rex/src/cli/index.ts`: add `criterion` to `MULTI_VALUE_KEYS` (which is spread into `VALUE_KEYS`) and `source` to `VALUE_KEYS`, so both `--criterion=\"x\"` and `--criterion \"x\"` forms parse. Pass `multiFlags` through `dispatchAdd` to `cmdAdd` (add a parameter; keep the existing call sites compiling). The `update` dispatch will need `multiFlags` too in the next task — you may thread it there now, but do not change update behaviour in this task.\n2. `packages/rex/src/cli/commands/add.ts`: when `--criterion` values are given, set `item.acceptanceCriteria` to them in argv order, trimmed, with empty values dropped. When `--source` is given, set `item.source`. Without the flags the item is written exactly as today.\n3. Smart and file mode (`rex add \"description\"`, `rex add --file=...`) do not take these flags: if `--criterion` or `--source` is passed without manual mode, fail with a `CLIError` that says they need `--title` (manual mode). Do this in `dispatchAdd` before smart mode reads stdin, so it errors instead of hanging (see the comment there and `packages/rex/tests/e2e/add-stdin-hang.test.ts`).\n4. `--format=json` output of `rex add` includes `acceptanceCriteria` and `source` when they were set.\n5. Help: in `packages/rex/src/cli/help.ts` `add` entry, add `--criterion=\"...\"` (\"Acceptance criterion, manual mode only (repeatable, one per flag)\") and `--source=\"...\"` options and one example, e.g. `rex add task --title=\"Login form\" --parent=abc --criterion=\"Rejects an empty password\" --criterion=\"Locks after 5 failures\" --source=ndx-capture`.\n\nTests:\n- Unit: `packages/rex/tests/unit/cli/commands/add.test.ts` — criteria and source land on the stored item; criteria order is preserved; empty values are dropped; no flags → no `acceptanceCriteria` content change from today.\n- Spawn-level: extend `tests/e2e/cli-add.test.js` (or `packages/rex/tests/e2e/cli-workflow.test.ts`) so a real `rex add ... --criterion=A --criterion=B` writes both criteria into the item's `index.md` in `.rex/prd_tree/` — this pins the argv parsing, not just cmdAdd.\n- The smart-mode rejection exits non-zero with the message and does not hang."
lastModified: "2026-10-08T18:23:04.877Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
