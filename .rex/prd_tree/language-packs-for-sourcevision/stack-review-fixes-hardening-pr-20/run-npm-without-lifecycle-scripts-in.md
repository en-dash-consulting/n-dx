---
id: "3a292851-1103-4ba2-a26b-7b9e61a16f80"
level: "task"
title: "Run npm without lifecycle scripts in sv pack"
status: "in_progress"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "sourcevision"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:58:55.810Z"
acceptanceCriteria:
  - "sv pack add and bundle run npm with --ignore-scripts --no-audit --no-fund; remove's uninstall with --ignore-scripts"
  - "Dry-run expectations and documented command lines updated"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network; the npm calls are tested through the existing injected-npm seams, not a real install."}
description: "Stack review (#772, packages/sourcevision/src/cli/commands/pack.ts around line 211, and bundle around line 284). `ndx sv pack add java` (or `sv pack bundle`) runs every preinstall/install/postinstall script in the pack's dependency tree with the user's privileges. No pack needs one: grammars are prebuilt WASM, the design says no SDK, and prepare doesn't run for registry tarballs. The tree is small and exact-pinned today, but that is the only thing between a compromised transitive dependency and code execution at install time.\n\nFix:\n- add `--ignore-scripts --no-audit --no-fund` to add and bundle;\n- add `--ignore-scripts` to remove's uninstall;\n- update the dry-run expectation in tests/e2e/cli-pack.test.ts and the documented command lines (sourcevision AGENTS.md / README / docs).\n\nTests: the npm argument lists include the flags for each command."
lastModified: "2026-10-17T09:58:56.130Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
