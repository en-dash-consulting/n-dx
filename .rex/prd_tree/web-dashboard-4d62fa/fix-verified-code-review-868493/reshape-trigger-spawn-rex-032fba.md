---
id: "032fbaf4-b120-4dc1-9bc3-004bc3d9d93f"
level: "task"
title: "Reshape trigger: spawn rex reshape with --quiet so stdout parses as JSON"
status: "completed"
priority: "critical"
startedAt: "2026-08-18T21:37:45.149Z"
completedAt: "2026-08-18T21:41:07.153Z"
endedAt: "2026-08-18T21:41:07.153Z"
acceptanceCriteria:
  - "Reshape preview with proposals renders the proposal list and the Apply button (report parses non-null)"
  - "The spawned reshape command includes --quiet so stdout is pure JSON in the proposals case"
  - "Regression test covers prose-before-JSON stdout (today's failure) and pure-JSON stdout parsing correctly"
description: "Blocking. handleReshape (routes-commands.ts) runs 'rex reshape --format=json' through startAsyncJob, which does JSON.parse(result.stdout). But reshape emits info() prose before the JSON (reshape.ts:150 'Analyzing PRD structure...' and the numbered proposal list at 177-181), and --format=json does not imply quiet (rex cli index.ts:538 only honors the quiet flag). Parse always fails, report stays null, and ValidationActions renders 'No restructuring proposed' with no Apply button even when proposals exist — a false negative. Fix: append --quiet to the reshape cmdArgs (info() suppressed, result() still emits JSON). Note: in the genuinely-zero-proposals case reshape returns prose via result() before the JSON block (reshape.ts:171-173), so the report is null there even with --quiet — the UI message is coincidentally correct; emitting a JSON report for that case is an optional rex-side follow-up."
---
