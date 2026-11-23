---
id: "01aca0f9-434c-4c2a-aa9c-67a3d6616fd6"
type: "change"
title: "killWithFallback's grace timer keeps the event loop alive after the child exits"
slug: "killwithfallback-s-grace-timer-keeps"
intent: "packages/llm-client/src/exec.ts `killWithFallback` (~1507) starts a grace-period setTimeout (default 5 s) that is never cleared, so a child that exits early still holds the event loop for up to gracePeriodMs, delaying process exit.\n\nReachable: yes, every kill of a child that exits within the grace period.\n\nFix options: (1, recommended) clear the timer on the child's exit, or unref it; small. Changes process-exit timing only.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "After a child killed with killWithFallback exits, no grace timer remains pending"
  - "A unit test kills a fast-exiting child and asserts no pending timer (fake timers)"
touches:
  - "8abe3c45-9434-4862-aeee-0f56f107d130"
priority: "low"
source: "ndx-adversarial-review"
---
