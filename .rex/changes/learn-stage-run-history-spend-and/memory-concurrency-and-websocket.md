---
id: "3044e7b8-703d-48ae-a651-acf4fdad8305"
type: "task"
title: "Memory, Concurrency and WebSocket Health panels render nowhere after the Runs System status drawer was removed"
slug: "memory-concurrency-and-websocket"
description: "Verdict: should-fix (low). Commit 295343948 removed the Runs page's System status drawer (packages/web/src/viewer/views/hench-runs.ts, formerly ~L1561) on the grounds that Live has the throttle and stop. Live does cover throttle and emergency stop (live.ts L114, L347–360). But ConcurrencyPanel, MemoryPanel and WsHealthPanel were rendered only in that drawer. They are still exported from components/index.ts and keep their unit tests, yet no view mounts them. Scenario: an operator opens /hench-runs to check machine memory or WebSocket health, and the dashboard no longer shows either anywhere. Options: (a) delete the three components, their CSS and tests, and ThrottleControlsPanel if Live's controls fully replace it. Cheap; drops the diagnostics. (b) Re-home them in Live's side column or the Settings overlay. Costs a small layout change. Recommend (b) for memory and concurrency, which matter while runs are live, and (a) for WS health unless someone uses it. Decision for the owner: whether these diagnostics stay in the product."
acceptanceCriteria:
  - "Each of ConcurrencyPanel, MemoryPanel, WsHealthPanel and ThrottleControlsPanel is either rendered by some view or deleted with its CSS and tests"
  - "A test fails if one of these components is exported but no view renders it"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
