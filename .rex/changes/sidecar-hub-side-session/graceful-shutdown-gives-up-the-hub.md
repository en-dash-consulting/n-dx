---
id: "21c2ba30-9be8-46b1-96ac-2531c0dd753b"
type: "task"
title: "Graceful shutdown gives up the hub session host lock while a hub turn may still be writing the session"
slug: "graceful-shutdown-gives-up-the-hub"
description: "Verdict: should-fix (adversarial review of task 1240c8fa).\n\nScenario: server A hosts the hub session and has a hub turn running. The operator stops A (Ctrl-C or SIGTERM). registerShutdownHandlers in packages/web/src/server/start.ts calls releaseHubSessionHostOnShutdown in step 0, before step 1 (child processes) and step 3 (HTTP drain, which can take up to N_DX_SHUTDOWN_TIMEOUT_MS). Nothing in shutdown ends or waits for Sidecar turns. The hub's next request picks server B, B claims the now-free lock and resumes the session from disk, and runs a turn while A's turn is still appending frames to the same transcript and index under <ndx home>/hub/sidecar/. Two writers to one session.\n\nReachable: `ndx start` stopped while the hub drawer has a turn in flight, and the operator sends another turn through the hub within the shutdown window. Before this change the lock lasted until A exited (dead-pid takeover), so the window is new.\n\nOptions:\n(a) Recommended: at shutdown, interrupt the hub registry's running turns and await whenIdle() with a short bound, then release. Small change in routes-sidecar.ts plus a shutdown hook. Risk: a slow interrupt delays shutdown, so keep the bound.\n(b) Move the release to after step 3 (HTTP server closed). Narrows the window but doesn't close it, because a turn outlives its 202 response."
acceptanceCriteria:
  - "When a server that holds the hub session host lock shuts down gracefully with a hub turn running, the lock is not removed until that turn has been stopped or has finished"
  - "A test shuts down a lock-holding server mid-turn and shows a second server's hub session request is answered 409 until the turn settles, then served"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
