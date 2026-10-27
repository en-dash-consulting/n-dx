---
id: "74391a2b-d0b6-405a-83d1-cbae47a1152d"
type: "task"
title: "Flow 2 navigates away right after clicking Full analysis, racing the POST that starts it"
slug: "flow-2-navigates-away-right-after"
description: "Severity: medium (flaky failure, not a false pass). Verdict: should-fix.\n\nFAILURE SCENARIO\nanalyze-add-complete.spec.ts clicks \"Full analysis\" (line 96) and immediately page.goto('/live/analyze') (line 98). The click handler's fetch to POST /api/commands/sv-analyze is cancelled by the navigation if it has not been dispatched yet; then waitForAnalysisToFinish sees running:false at once, the manifest stamp is unchanged, and the spec fails on the stamp assertion — correct but flaky under load.\n\nSOLUTION: after the click, wait for the button to read \"Running full analysis…\" (or for GET /api/commands/sv-analyze/status to report running: true, or the tray entry) before navigating."
acceptanceCriteria:
  - "The spec waits for evidence that the analysis has started (button state or status route) before leaving the Analysis page"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
---
