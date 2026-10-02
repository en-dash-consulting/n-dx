---
id: "7cd7ba65-31c0-4b01-b881-52bb745fd473"
level: "task"
title: "--resolve omits review-optional from its options, and its command drops --mine and --review-optional"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "resolved and options include reviewOptional, and the web run-options allow-list and contract test include it."
  - "The printed command reproduces --mine and --review-optional when passed; a test covers both."
description: "Verdict: should-fix. Bundled: both are gaps in the same option table and command builder (packages/hench/src/cli/commands/run-resolve.ts:132-144 and :367-385).\n\nScenario 1: the dashboard can switch review on but cannot send --review-optional; resolve parses it (parseReviewOptions) but never reports it in resolved or options, so criterion 6 of task 3e07628e is unmet. Scenario 2: `ndx work --task=task-2 --resolve --review --review-optional --mine --reset-deferred .` prints `ndx work --task=task-2 --auto --review --reset-deferred <dir>` (confirmed); running it resets every operator's deferred tasks (the scope bug run.ts:612-635 warns about) and makes review mandatory.\n\nFix (recommended): add reviewOptional to resolved and options (and to the web allow-list and contract); make the command include every flag that changes behaviour (--mine, --review-optional, --priority, --context-file), or refuse to emit `command` while unlisted flags are present."
lastModified: "2026-10-02T07:47:41.306Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
