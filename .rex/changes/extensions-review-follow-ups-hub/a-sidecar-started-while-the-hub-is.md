---
id: "c400642c-8e21-4338-b3c5-997c2a3be4a2"
type: "task"
title: "A sidecar started while the hub is closing is orphaned, or keeps an exiting hub alive"
slug: "a-sidecar-started-while-the-hub-is"
description: "Verdict: should-fix. Hub close (packages/web/src/hub/hub.ts:645-660) runs sidecars.stopAll() then awaits hub.stopAll() before server.close(); SidecarManager (sidecars.ts:321-362) has no closed state, so a /x/foo/ request in that window, or a start still in its plan phase, spawns a sidecar nobody stops. On POSIX it survives ndx hub stop; on the onEmpty close path it keeps the event loop alive. Fix (recommended, both): a closed flag set in stopAll that makes start refuse with 503 on entry and again after the plan await; stop accepting connections before awaiting hub.stopAll()."
acceptanceCriteria:
  - "After stopAll begins, no sidecar process is spawned, including one whose plan was in flight"
  - "A test starts a sidecar request during close and asserts no child survives"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
