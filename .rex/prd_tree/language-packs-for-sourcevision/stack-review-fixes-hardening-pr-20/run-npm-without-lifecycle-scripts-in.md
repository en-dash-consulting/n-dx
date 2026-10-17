---
id: "3a292851-1103-4ba2-a26b-7b9e61a16f80"
level: "task"
title: "Run npm without lifecycle scripts in sv pack"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "sourcevision"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:58:55.810Z"
completedAt: "2026-10-17T10:10:35.463Z"
endedAt: "2026-10-17T10:10:35.463Z"
resolutionType: "code-change"
resolutionDetail: "sv pack add/bundle run npm install --ignore-scripts --no-audit --no-fund; remove runs npm uninstall --ignore-scripts. Tests and docs updated."
acceptanceCriteria:
  - "sv pack add and bundle run npm with --ignore-scripts --no-audit --no-fund; remove's uninstall with --ignore-scripts"
  - "Dry-run expectations and documented command lines updated"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Retry: the code change is committed (f01e66207), but the test gate failed on tests/e2e/agents-md-size-budget.test.js. The root + packages/sourcevision/AGENTS.md chain is 30834 bytes against a 30720 budget. Move the sv pack command details (flags, offline bundles, pack dir) out of packages/sourcevision/AGENTS.md into a docs page (e.g. docs/sourcevision/language-packs.md, or the existing docs page that covers sv pack if there is one), leaving a one-line pointer, and aim for at least 1 KB of headroom under the budget: the next two tasks (pack-dir lock, bundle integrity) add sv pack docs too, and they must go to that docs page. Do not raise the budget. Then run tests/e2e/agents-md-size-budget.test.js and tests/e2e/instruction-alignment.test.js before finishing."}
description: "Stack review (#772, packages/sourcevision/src/cli/commands/pack.ts around line 211, and bundle around line 284). `ndx sv pack add java` (or `sv pack bundle`) runs every preinstall/install/postinstall script in the pack's dependency tree with the user's privileges. No pack needs one: grammars are prebuilt WASM, the design says no SDK, and prepare doesn't run for registry tarballs. The tree is small and exact-pinned today, but that is the only thing between a compromised transitive dependency and code execution at install time.\n\nFix:\n- add `--ignore-scripts --no-audit --no-fund` to add and bundle;\n- add `--ignore-scripts` to remove's uninstall;\n- update the dry-run expectation in tests/e2e/cli-pack.test.ts and the documented command lines (sourcevision AGENTS.md / README / docs).\n\nTests: the npm argument lists include the flags for each command."
lastModified: "2026-10-17T10:10:35.765Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
