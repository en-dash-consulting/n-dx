---
id: "d3e8d81c-b5db-4094-ad90-f4df8fe06082"
type: "task"
title: "A restarted sidecar's request and socket counts can be decremented by the previous instance's connections"
slug: "a-restarted-sidecar-s-request-and"
description: "Verdict: should-fix. stopSidecar zeroes inflight/sockets and waits up to 5 s in killWithFallback (packages/web/src/hub/sidecars.ts:415-424, 248-268); a restart in that window counts a new WebSocket, then the old socket's close drops the count to 0 and the idle sweep kills the new sidecar under an open WebSocket. Fix: tag counts with the instance (handle or generation) in beginRequest/openSocket and decrement only when it still matches."
acceptanceCriteria:
  - "Closing a connection from a stopped sidecar instance never changes the counts of its replacement, covered by a test"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
