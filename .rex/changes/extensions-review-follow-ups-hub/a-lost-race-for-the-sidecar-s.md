---
id: "ecfcc5a2-aff2-4a3d-832e-b402dd9dbdff"
type: "task"
title: "A lost race for the sidecar's ephemeral port can route one extension's traffic to another server"
slug: "a-lost-race-for-the-sidecar-s"
description: "Verdict: should-fix (cheap mitigation). freePort (packages/web/src/hub/sidecars.ts:140-150) closes its listener before the sidecar binds; if another process or a concurrently starting sidecar takes the port, the health probe gets 200 from the wrong server before ours exits EADDRINUSE, and /x/foo/ traffic (non-token cookies included) goes there. Fix: after a healthy probe confirm the spawned child is still alive, or pass a nonce in the environment that the health endpoint must echo (stronger, contract change)."
acceptanceCriteria:
  - "A sidecar that exits during or right after its health wait is never marked running"
  - "A test simulates the bind failure after another server answers health"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
