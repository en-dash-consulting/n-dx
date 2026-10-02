---
id: "41a95767-dd42-4d68-9f7b-831644025e88"
level: "task"
title: "--resolve reports no reviewer model unless --review is passed, so the modal cannot show who reviews"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`--resolve` without --review reports the reviewer model a review would use and its source; a test covers it."
  - "The modal shows that reviewer model when review is switched on, and choosing vendor default sends it; tests cover both."
description: "Verdict: should-fix. Bundled with the modal's review-model select, which cannot return to 'vendor default' (prepare-task-modal.ts:347 deletes the edit and snaps back to the configured model).\n\nScenario: run-resolve.ts:290-295 returns {value: null, source: 'built-in'} for reviewModel unless --review is passed; prepare-task-model.ts:102 then shows an empty review model when the user turns review on. 'built-in' is not a config key.\n\nFix (recommended): always resolve the reviewer model and its source key (resolveReviewModel), with review.value=false marking it inactive; let the select send an explicit 'vendor default' choice. Note the pre-existing llm-config drop of llm.<vendor>.reviewModel is tracked separately (57f63f2d)."
lastModified: "2026-10-02T07:47:42.905Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
