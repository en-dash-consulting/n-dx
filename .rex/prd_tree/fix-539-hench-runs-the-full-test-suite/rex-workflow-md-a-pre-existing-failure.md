---
id: "ef54a1ec-5275-4544-9711-3b8b67344ad3"
level: "task"
title: ".rex/workflow.md: a pre-existing failure introduced on this branch is fixed here; one already on main becomes its own task"
status: "completed"
priority: "medium"
tags:
  - "workflow"
  - "539"
  - "operator-decision"
source: "operator decision during the ndx-adversarial-review of fix/539-scoped-test-gate"
startedAt: "2026-10-06T22:27:40.791Z"
completedAt: "2026-10-06T22:32:03.626Z"
endedAt: "2026-10-06T22:32:03.626Z"
resolutionType: "code-change"
resolutionDetail: "Hench run f3e3c86c wrote the approved wording verbatim (commit 56c037ef2). The run was rejected as \"no changes\" because hench's completion check excludes all of .rex/, so the gate never ran. The operator verified with `run-all-tests.mjs affected 6b034fe91`, which selected root only, and root passed 160/160 files."
acceptanceCriteria:
  - ".rex/workflow.md contains the approved 'Pre-existing failures' paragraph verbatim and no longer contains 'log them and continue'."
  - "The combined n-dx_workflow.md + workflow.md stays under 4,000 characters."
  - "tests/e2e/prompt-census.test.js passes."
description: "Operator decision, 2026-10-06. Task 6 (4ecb7c25, commit 4af62c33b) rewrote `.rex/workflow.md` and replaced the old rule \"If test failures are pre-existing, fix them anyway\" with \"Pre-existing failures unrelated to your change: log them and continue. Do not fix them in this task.\" The operator rejected the new line.\n\n**Why.** CI runs every suite, so a failure an agent logged and left still fails the branch's PR. On a multi-task branch with a scoped gate, \"pre-existing\" to task N is often task N-1's regression in a suite task N-1's gate did not select. That failure is this PR's own defect. A failure that is already red on main is not the branch's to fix inside an unrelated task, because that invites scope creep and weakened tests.\n\n**Change.** In `.rex/workflow.md`, replace the line \"Pre-existing failures unrelated to your change: log them and continue. Do not fix them in this task.\" with exactly this approved wording:\n\n> **Pre-existing failures.** A failing test you did not cause still blocks this branch's PR, because CI runs every suite. If the failing test or the code it covers changed on this branch (`git log main..HEAD -- <paths>`), it is this branch's defect: fix it here. If it is not, do not fix it inside this task: record it with `append_log` and in your summary so it becomes its own task. Never skip, weaken or delete a test to get green.\n\nChange nothing else in the file.\n- Keep the combined workflow (`.rex/n-dx_workflow.md` + `.rex/workflow.md`) under the 4,000-char brief cap (`packages/hench/src/agent/planning/context-caps.ts:26`). Check with `wc -c .rex/n-dx_workflow.md .rex/workflow.md`.\n- `.rex/workflow.md` is a root-selecting instruction surface for `run-all-tests.mjs affected`, and it is not a prompt-census surface. If `tests/e2e/prompt-census.test.js` fails, regenerate the baseline with `node scripts/prompt-census.mjs --write` on a clean tree after committing. That script refuses a dirty tree.\n\n**Validation.**\n- `node_modules/.bin/vitest run tests/e2e/prompt-census.test.js` and the six root policy tests from the epic conventions.\n- Do not run the full suite."
lastModified: "2026-10-06T22:32:04.085Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
