---
id: "38fce780-09ae-4f8f-842b-64321c23a839"
type: "task"
title: "CAOS epic picker lists only the first 25 epics: a field hint's read sends no arguments, so list_epics uses its default page size"
slug: "caos-epic-picker-lists-only-the-first"
description: "Found by the adversarial review of the server-profiles task (6aa7f142). Verdict: should-fix, severity medium.\n\nFailure: the built-in CAOS profile (packages/web/src/server/tracker/profiles/caos.json) hints create_work_item.epicId from list_epics, path \"items\". A hint's read tool is always called with {} (packages/web/src/server/sidecar/external-call.ts readOptions). Real CAOS list_epics pages with pageSize default MCP_PAGE_DEFAULT = 25, max 100, plus nextCursor (caos app/models/mcp-contract.ts PAGE_PROPERTIES). The CAOS Epics source holds epics and features together, already more than 25, so the epic picker on a create card silently lacks most features. The fake server in tests returns two epics, so nothing catches it.\n\nReachable: every Sidecar create_work_item card on a CAOS connection with profile \"caos\".\n\nOptions:\nA (recommended). Let a hint carry literal read arguments: FieldHint optionsFrom gains an optional \"arguments\" object passed to the read call; caos.json sets { \"pageSize\": 100 }. Small, generic, data only. Still caps at 100.\nB. Follow nextCursor up to MAX_FIELD_OPTIONS (200) within the hint timeout. Complete, but tracker-specific pagination knowledge in a generic module unless the cursor field is also declared in the hint.\nC. Both: arguments plus an optional declared cursor path.\nThe profile check should verify any hint argument names a declared input property of the read tool."
acceptanceCriteria:
  - "A field hint can name literal arguments for its read tool, and the external-call card passes them to the read call (test with a fake server that records the call's arguments)"
  - "The built-in CAOS profile asks list_epics for its maximum page (pageSize 100), and a fake list_epics with more than 25 epics yields more than 25 picker options (test)"
  - "The profile check refuses a hint argument the read tool's input does not declare, naming it (test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
