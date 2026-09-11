---
id: "5fe55ced-a1dd-4c54-b471-647ede89caf4"
level: "task"
title: "Refuse to mark a task completed while its work is uncommitted"
status: "pending"
priority: "critical"
tags:
  - "hench"
  - "gh-363"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
acceptanceCriteria:
  - "A task whose agent leaves files uncommitted does not reach status completed; the run reports the uncommitted paths."
  - "The happy path is unchanged: a task whose work is committed completes exactly as today."
  - "Hench runtime artifacts (.hench/locks, .hench/runs, usage cursors) do not count as dirty, matching the pre-run gate's existing discount."
  - "A --loop run cannot start a task while the previous task's output is uncommitted."
  - "Unit tests cover: clean tree completes; dirty tree refuses; runtime-artifact-only dirt still completes."
description: "GitHub #363. Severity: critical — silent loss of finished work, and the status field reports the opposite of the truth.\n\nFAILURE SCENARIO\nA task's agent writes its files, the run ends, and only the PRD status commit lands:\n\n  chore(prd): commit PRD tree changes (task <id> completed)\n\nThe code sits uncommitted in the working tree. Observed three times in one session: task 6879f7b0 left packages/hench/tests/unit/process/git-origin.test.ts (105 lines, 18 passing tests) plus a stray root-test-output.log; tasks 63592288 and 9f0a2b51 together left 15 files including README, CLAUDE.md, three guides, the shared project-guidance asset, two changesets and a new rex module. Recovered by hand in a306968d and 71c676c5.\n\nIt compounds in a --loop run: the next task starts on a tree still holding the previous task's output, so the files tangle together, and the pre-run commit gate then refuses to start because of them.\n\nSOLUTION\nBefore writing status: completed, check whether the working tree is dirty (excluding the hench runtime artifacts already discounted by the pre-run gate — see excludeHenchRuntimeArtifacts in packages/hench/src/store/artifacts.ts). If it is dirty, either commit it as part of completion or fail the task loudly naming the uncommitted paths. Do not report success.\n\nAlso clean up scratch files the agent writes into the repo root (root-test-output.log was left behind)."
lastModified: "2026-09-11T18:56:18.283Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
