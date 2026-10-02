---
id: "ab2941da-d035-4f20-8e9a-c053de20b166"
level: "task"
title: "New styles use undefined tokens --text-secondary and --danger, failing light-theme contrast"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-viewer"
  - "a11y"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "No stylesheet added on this branch references a custom property that tokens.css does not define; a test or lint scan enforces it."
  - "Blocker text and error toasts meet 4.5:1 contrast in light and dark themes."
description: "Verdict: should-fix (cheap; AA contrast failure).\n\nScenario: styles/components.css and styles/prepare-task.css use --text-secondary (not in tokens.css), so .task-blockers falls back to #9ca3af — about 2.5:1 on white; --danger is undefined too, so the .ready-toast-error border is currentColor. Fix (recommended): use the existing theme tokens for secondary text and danger, in both themes."
lastModified: "2026-10-02T07:47:49.285Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
