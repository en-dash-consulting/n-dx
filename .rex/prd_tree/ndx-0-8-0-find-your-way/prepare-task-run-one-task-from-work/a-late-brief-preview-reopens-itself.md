---
id: "8ce63ecb-14d3-4250-a098-9a58ac90f0ea"
level: "task"
title: "A late brief preview reopens itself after Back, and switching form/preview drops focus"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-viewer"
  - "a11y"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A preview response that arrives after Back (or after a newer preview request) is ignored; a test covers it."
  - "Opening the preview focuses its heading and Back returns focus to the Preview brief button; a test covers both."
description: "Verdict: should-fix. Bundled: both live in the same preview toggle (prepare-task-modal.ts:174-211).\n\nScenario 1: press Preview brief, press Back before the dry run returns, edit a field; the stale response calls setPreview and the view jumps back to a preview built from old options. Scenario 2: the focused button is removed on toggle, focus drops to <body>; the trap pulls it back on Tab but screen readers lose their place.\n\nFix (recommended): a request-sequence ref that drops stale replies; move focus to the preview heading on open and back to the Preview button on Back."
lastModified: "2026-10-02T07:47:36.535Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
