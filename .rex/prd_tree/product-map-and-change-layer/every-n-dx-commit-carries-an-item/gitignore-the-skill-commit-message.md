---
id: "92230d04-189e-4f54-a676-6c5144aef64f"
level: "task"
title: "Gitignore the skill commit-message scratch file"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "`.ndx-commit-msg.txt` is listed beside `.hench-commit-msg.txt` in .gitignore, packages/core/assistant-assets/ndx.gitignore, BOOKKEEPING_EXCLUDES in prior-attempt-work.ts, and the runtime-artifact handling in shared.ts"
  - "tests/unit/ndx-gitignore-template.test.js fails if the ndx.gitignore asset stops listing `.ndx-commit-msg.txt`"
  - "A leftover `.ndx-commit-msg.txt` is not counted as prior-attempt work or committed by hench's leftover-changes commit (test)"
description: "From Ryan's review of #619 (2026-10-09 05:04Z, SKILLS.md:66). The skills now write their commit message to `.ndx-commit-msg.txt` at the project root, but unlike its sibling `.hench-commit-msg.txt` it is in none of the places that keep a runtime artifact out of history: the repo .gitignore (line 14), the ndx.gitignore asset that `ndx init` installs (packages/core/assistant-assets/ndx.gitignore:33), hench's BOOKKEEPING_EXCLUDES (packages/hench/src/agent/lifecycle/prior-attempt-work.ts:27), and the runtime-artifact list in packages/hench/src/agent/lifecycle/shared.ts (~line 887). If `git commit -F .ndx-commit-msg.txt` fails (a hook rejects it, nothing staged, the session is interrupted) the delete never runs, and the user's next `git add -A`, or hench's commit of leftover changes before a run, commits it. Add it next to `.hench-commit-msg.txt` in all four. Before finishing, run `pnpm build` in packages/hench: the test gate reads hench through dist/ and fails a run that edits source without rebuilding (the stale-dist failures of runs 31bed159 and 3aa0f093)."
lastModified: "2026-10-09T05:10:08.996Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
