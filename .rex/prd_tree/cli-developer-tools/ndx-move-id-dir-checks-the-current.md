---
id: "91c75938-b97d-4de7-8670-68466b99964b"
level: "task"
title: "`ndx move <id> [dir]` checks the current directory for .rex instead of the directory it names"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "core"
source: "ndx-adversarial-review"
startedAt: "2026-10-16T06:02:43.579Z"
completedAt: "2026-10-16T06:09:41.113Z"
endedAt: "2026-10-16T06:09:41.113Z"
acceptanceCriteria:
  - "`ndx move <id> --parent=<pid> <dir>` run from a directory that is not a project moves the item in <dir>; an e2e test asserts it"
  - "With no directory argument the command still resolves the current directory, and the item id is never treated as one — a test asserts the failure names the cwd, not a path built from the id"
  - "handleMove forwards `rest` to `rex move` unchanged, so the delegation keeps rex's own positional handling"
description: "Out-of-scope finding carried out of the e47a4981 review of the rex log follow-ups, which fixed the same defect in handleLog and recorded handleMove as having the identical shape.\n\nhandleMove (packages/core/cli.js:2863) calls requireInit(process.cwd(), [\"rex\"]) and then forwards `rest` unchanged, so the `[dir]` its own help documents (`ndx move <id> --parent=<new-parent-id> [dir]`, help.js move.usage) is never used for the precondition. Run from anywhere that is not itself a project, the command fails with NDX_CLI_NOT_INITIALIZED naming the current directory, even though the directory argument names a real project. The comment on the line above (\"First positional arg is the item ID, not a dir\") shows the author saw the hazard and worked around it by checking cwd rather than resolving the second positional.\n\n`rex move` already reads the shape correctly — packages/rex/src/cli/index.ts:461 takes `positional.length > 1 ? resolve(positional.at(-1)) : process.cwd()`, byte-identical to its `log` case — so only the orchestrator precondition is wrong, and the delegation needs no change.\n\nFailure scenario: from a directory with no .rex, `ndx move <item-id> --parent=<parent-id> /path/to/project` exits non-zero with \"Missing .rex in <cwd>\" and moves nothing.\n\nFix: resolve the directory from the second positional, exactly as handleLog now does — `const positional = rest.filter((a) => !a.startsWith(\"-\")); const dir = positional.length > 1 ? positional[positional.length - 1] : process.cwd();` — and keep forwarding `rest` unchanged. resolveDir cannot be reused: it takes the LAST positional, and with no directory given the item id is the last positional, so `ndx move abc --parent=def` would look for a project at ./abc. Risk: low, and the same shape is already covered for `ndx log` by tests/e2e/cli-log-dir.test.js."
lastModified: "2026-10-16T06:09:41.701Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
