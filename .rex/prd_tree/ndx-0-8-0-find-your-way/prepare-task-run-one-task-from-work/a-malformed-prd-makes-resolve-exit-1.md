---
id: "ee80a5d3-ae42-4b83-ad0f-9a625646dd47"
level: "task"
title: "A malformed PRD makes --resolve exit 1 with no JSON, so the dashboard gets nothing to show"
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
  - "With an unreadable PRD, `ndx work --task=x --resolve .` prints JSON with a prd-unreadable refusal and exits 0; a test covers a corrupt tree file."
description: "Verdict: should-fix.\n\nScenario: a corrupt .rex/prd.json or an unparseable tree file makes run-resolve.ts:185-186/207 throw: exit 1, `Error: [NDX_CLI_GENERIC] Expected ',' or '}'…`, no JSON (confirmed). The prep route then answers 502 with a parse error instead of a refusal the modal can show. Fix (recommended): catch load failures and return task: null with a `prd-unreadable` refusal carrying the message, exiting 0."
lastModified: "2026-10-02T07:47:44.498Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
