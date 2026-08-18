---
id: "08ca827b-1a2d-4c32-b555-64a5eaffc271"
level: "task"
title: "Validation view: render CI report on failing exit instead of raw error banner"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "A CI run that exits 1 with a parsed JSON report renders the report with its ok:false state"
  - "The error banner appears only when no report was parsed"
description: "ndx ci exits 1 when a check fails while still printing the complete JSON report (ok:false plus steps) to stdout. startAsyncJob sets status.error on any non-zero exit (routes-commands.ts:748), and the poll callback in validation.ts (~722) returns on status.error before reading status.report — so 'CI found problems, here they are' renders as a red banner containing the stderr tail while ciReport stays null. Fix: key on the parsed report (its own ok field carries pass/fail); fall back to the error banner only when no report parsed."
---
