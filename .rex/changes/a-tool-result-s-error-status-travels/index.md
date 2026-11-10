---
id: "b37b71d8-e1f6-43d3-9efb-4a82d82d2acf"
type: "change"
title: "A tool result's error status travels only as an \"[error] \" output prefix, so Codex errors read Done and a success printing \"[error] \" reads Failed"
slug: "a-tool-result-s-error-status-travels"
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task 99e2bdb7 (run 0ec3cfdc).\n\nThe Sidecar transcript decides a card-less call failed from `toolResultIsError(output)` (packages/web/src/viewer/components/sidecar-tool-names.ts), which tests for the \"[error] \" prefix. Only llm-client's Claude stream-json content-block parser writes that prefix (packages/llm-client/src/vendor-session-driver.ts:304, from `is_error`). RuntimeEvent.toolResult (runtime-contract.ts:212) has no error field.\n\nFailure scenarios:\n1. A Codex Sidecar session's call fails, or the broker refuses it. The Codex parse paths (`function_call_output`, the command_execution item) never set the prefix, so the pill reads Done.\n2. A Claude Bash call exits 0 and its output starts with \"[error] \". The pill reads Failed.\n\nReachability: the Sidecar drawer transcript, for any Codex lens session (1) or any agent command whose stdout starts with that text (2).\n\nOptions:\n- A (recommended): add an optional `isError?: boolean` to RuntimeEvent.toolResult. Set it in the Claude parser from `is_error`, and in the Codex parser where the item carries a failed status or non-zero exit code. Carry it through hench's persisted frames (schema v1 + validate.ts) and the viewer's SidecarRuntimeEvent, and read it in the drawer. Keep the prefix in `output` for hench's existing consumers. Cost: a contract field across llm-client, hench and web, plus a test at each layer. Risk: low, because the field is additive.\n- B: keep the prefix and add it on the Codex paths too. This is cheaper, but it keeps the false positive in (2)."
acceptanceCriteria:
  - "A Codex Sidecar tool result for a failed call (non-zero exit or failed status) renders its pill as Failed (viewer + llm-client parser tests)"
  - "A Claude tool result with is_error false whose output begins with \"[error] \" renders its pill as Done (viewer test)"
  - "RuntimeEvent.toolResult carries an explicit error flag that hench persists and the Sidecar viewer reads (contract test)"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"99e2bdb7-df41-4278-8cf7-c20b1776935c","run":"0ec3cfdc-853a-42a0-b6d1-42308a93eae6"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
