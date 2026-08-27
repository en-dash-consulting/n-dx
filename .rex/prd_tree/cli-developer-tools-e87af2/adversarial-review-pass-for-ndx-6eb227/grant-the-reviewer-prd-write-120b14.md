---
id: "120b14f2-6cf0-4929-a413-353133eaca77"
level: "task"
title: "Grant the reviewer PRD-write permission so findings can be captured in non-interactive runs"
status: "pending"
priority: "high"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "A non-interactive review-enabled run creates PRD items for should-fix and out-of-scope findings"
  - "Report findings that were successfully captured carry action=\"captured\" and a populated itemId"
  - "If capture is still denied, the run surfaces it as an explicit warning rather than only inside the report file"
  - "The reviewer's permitted tool surface is documented alongside the executor's"
description: "Half the feature's purpose is \"captures the rest to the PRD\" — findings that are real but not must-fix become tracked items instead of being lost. In run 60c3a951 that path did not work: the reviewer called mcp__rex__add_item and it was denied for lack of granted permission in the non-interactive session. All four capture-worthy findings were written to the report with action=\"failed\" instead.\n\nThe degradation was graceful and well-handled — the reviewer preserved every finding's full analysis and intended parent ID in the report rather than dropping them, and said plainly that capture had failed. But the feature currently cannot capture in exactly the autonomous mode it is built for, which means every unattended review-enabled run silently produces zero PRD items.\n\nFix is a permission/config question, not a code-logic one: the spawned reviewer needs the rex MCP write tools allowlisted for the run (alongside the permissionMode already set for edits). Worth checking whether the executor's own update_task_status succeeded in the same run — it did — to see why add_item specifically was denied."
lastModified: "2026-08-27T16:47:59.514Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
