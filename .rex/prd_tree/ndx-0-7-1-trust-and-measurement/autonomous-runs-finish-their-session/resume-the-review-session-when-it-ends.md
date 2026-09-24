---
id: "1bfcfdad-85c1-4f72-a2a8-704e890be431"
level: "task"
title: "Resume the review session when it ends waiting instead of writing its report"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "pr-bg"
  - "hench"
  - "adversarial-review"
  - "run-lifecycle"
source: "PR M execution, 2026-09-24 (run 01d15d75)"
acceptanceCriteria:
  - "A review stream fixture that ends waiting on a background command, with no report file, produces exactly one resume, and the resumed session writes the report."
  - "A reviewer that ends waiting twice is recorded as no-report, as today, and no third spawn happens."
  - "A review that writes its report is never resumed."
description: "The adversarial review resumes a fork of the work session, so it inherits any background job the work session left running. In run 01d15d75 the reviewer said \"The full suite is still running; I'll fold its result in before writing the report file\", produced its findings in text, and ended without writing `.hench/reviews/<runId>.json`. hench reported \"PRODUCED NO REPORT — this task was NOT reviewed\" although the review had been done. Apply the same detection as the work-session task to the review spawn; on a match, resume the reviewer once with a fixed message telling it to write the report now from what it has."
lastModified: "2026-09-24T20:30:03.032Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
