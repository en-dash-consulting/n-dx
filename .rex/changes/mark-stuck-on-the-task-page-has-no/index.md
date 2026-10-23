---
id: "f7894484-1299-4eaa-9b1c-ea32efdd3e6b"
type: "change"
title: "Mark stuck on the task page has no confirmation and shows on healthy runs, so one click marks a working run failed"
slug: "mark-stuck-on-the-task-page-has-no"
intent: "Failure: `packages/web/src/viewer/views/live-task.ts:102,147-149` shows Mark stuck for every running run and posts immediately. The server (`routes-hench.ts:2096`) only checks `status === \"running\"`, sets the record to failed and does not stop the process, so the agent keeps working while its record says it failed. Only Stop calls `window.confirm`. Double-clicks are not an issue (`busy` disables the buttons).\n\nReachability: one click on any running task page. Verdict: should-fix (severity medium).\n\nOptions:\n- Recommended: confirm before marking, and show the button only when the run is stale (no heartbeat for the shared 5-minute threshold). Small."
acceptanceCriteria:
  - "Mark stuck asks for confirmation before posting (unit test)."
  - "Mark stuck is shown only for runs the live snapshot marks stale (unit test with a fresh and a stale run)."
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
---
