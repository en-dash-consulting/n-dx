---
id: "27941544-9c93-47cf-afdb-44e87e7a57f5"
type: "task"
title: "Verdict summaries name each file once, the banner leads the task panel with a readable class, and Ready next links its tasks"
slug: "verdict-summaries-name-each-file-once"
description: "Found checking R1 (hench runs diagnose, the hench.runVerdict banner and Live Ready next) in the dashboard. (1) packages/hench/src/agent/analysis/run-verdict.ts: the test-gate summary and evidence list one file twice when the digest names it both package-relative and repo-relative (tests/unit/viewer/add-item-form.test.ts and packages/web/tests/unit/viewer/add-item-form.test.ts, real run 25f37b78 in sidecar-m2-drawer). That summary becomes the task failureReason and goes into the next brief, so it is not behind a toggle. Collapse a path that is a suffix of another listed path into the longer one. (2) packages/web/src/viewer/components/prd-tree: the verdict banner renders inside the Hench runs section near the bottom of the task detail panel, below criteria and usage, and shows the raw class id (test-gate-preexisting). Render it at the top of the task detail panel, below the title and status, with a readable label per class (for example Pre-existing test failure) and the raw id kept as a title or data attribute. (3) packages/web/src/viewer/views/live-ready-next.ts: Ready next task titles are plain text, while the Up next items it replaces are links that navigateTo the task. Make each task title a link the same way."
acceptanceCriteria:
  - "When the digest names one file package-relative and repo-relative, the verdict summary and evidence list it once (unit test with both forms)"
  - "With hench.runVerdict on, the banner renders at the top of the task detail panel, above the description, with a readable label for each of the nine classes (viewer test checks order and labels)"
  - "Each Ready next task title is a link that opens the task, as Up next items do (viewer test)"
  - "Nothing changes with either toggle off; the changeset notes the verdict summary fix"
priority: "medium"
source: "dogfood"
---
