---
id: "a0c1e9e5-20c2-4d91-9c09-5d813241a2f3"
type: "task"
title: "The concurrency-limit override and WebSocket health endpoints have no dashboard control after their panels were deleted"
slug: "the-concurrency-limit-override-and"
description: "Verdict: should-fix (low). Task 3044e7b8 deleted ThrottleControlsPanel and WsHealthPanel (packages/web/src/viewer/components/). Live covers pause/resume and emergency stop, but ThrottleControlsPanel was the only UI for the runtime concurrency override (PUT /api/hench/throttle, concurrencyOverride; see docs/archive/config-schema-ui-gap.md guard.maxConcurrentProcesses), and WsHealthPanel the only reader of GET /api/ws/health. Scenario: an operator wants to lower max concurrent runs for this session without editing config, and no control exists; the server routes stay as unreached surface. Decide per endpoint: add a small control (e.g. a slots stepper on Live's Hench slots tile) or retire the route and its tests."
acceptanceCriteria:
  - "A slots stepper on Live's Hench slots tile sets the concurrency override through the existing GET/PUT /api/hench/throttle; no new panel"
  - "GET /api/ws/health stays as a server probe, documented as one; no dashboard view reads it"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
