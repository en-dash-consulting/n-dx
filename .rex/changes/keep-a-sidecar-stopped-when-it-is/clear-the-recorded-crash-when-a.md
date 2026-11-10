---
id: "f0c744b1-e8ed-4eaa-9e01-039e25a6574e"
type: "task"
title: "Clear the recorded crash when a sidecar is stopped on purpose"
slug: "clear-the-recorded-crash-when-a"
description: "Review finding F1 on PR #929 (packages/web/src/hub/sidecars.ts:271). Sequence: a request revalidates a running sidecar, so ensure() sets s.starting and awaits plan(). The sidecar exits; the exit handler runs letGo(s) and sets s.crashed = handle. Then POST .../stop (routes.ts) calls stop(name): because s.starting is set it calls stopSidecar(s), which lets go again and answers stopped: true, but nothing clears s.crashed. When the plan resolves, revalidate() sees s.handle !== handle && s.crashed === handle and calls start(s), spawning a new instance. start() reads s.generation only after the stop, so its own generation check cannot catch it. Fix (reviewer's recommendation): set s.crashed = null in stopSidecar(), since a stop on purpose overrides an earlier crash. Do not add a generation field. Test: in packages/web/tests/integration/hub-sidecars.test.ts, add a third case next to the two revalidation tests this PR added: the crash-during-revalidation test plus await m.stop(\"recon\") after the exit is seen, then release the held plan. Keep the existing .changeset/sidecar-revalidate-crash.md (it already promises a stopped sidecar stays stopped); do not add another changeset."
acceptanceCriteria:
  - "stopSidecar clears the recorded crash, so revalidate() does not restart a sidecar stopped on purpose after it crashed"
  - "A new hub-sidecars.test.ts case crashes the sidecar while the revalidation plan is held, stops it with m.stop, and expects { ok: false, status: 404, reason: \"refused\" } and state \"stopped\""
  - "The new case fails without the stopSidecar change"
  - "The existing crash-during-revalidation and stop-during-revalidation tests still pass"
priority: "medium"
source: "ndx-capture"
---
