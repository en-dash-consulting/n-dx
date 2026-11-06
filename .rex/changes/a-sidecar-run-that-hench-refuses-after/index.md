---
id: "bc3a63a0-9ede-4af7-8f51-a861dda0f083"
type: "change"
title: "A Sidecar run that hench refuses after the 2 s starting phase is never reported to the agent"
slug: "a-sidecar-run-that-hench-refuses-after"
intent: "Found by adversarial review of c2b2b6c1 (run 3c097b6f). start_work (packages/web/src/server/routes-sidecar.ts startWork) waits only STARTING_PHASE_MS (2000 ms, routes-hench.ts) for the run to exit. `ndx work` cold-starts node, the ndx CLI, then hench, and only then runs the pre-run gate (git status, splitPlanningPaths). On a large repository or a loaded machine that takes more than 2 s. A dirty-tree refusal then arrives after start_work has already told the agent \"Started run … follow it on Live\". The card is revised to failed (broker.reviseCarriedOutFailed), but the agent's tool result has already been returned, so the agent goes on as if the run started.\n\nReachable: any approved Sidecar work card whose run refuses after more than 2 s.\nVerdict: should-fix (medium). The card and lane are already correct; only the agent stays misinformed.\n\nOptions:\n(a) The broker queues a note for the session's next turn (\"run X on task Y failed: <hench output>\") when a started run's card is revised. This is cheap and reuses the revision hook in broker-mcp.ts. Recommended.\n(b) Make start_work wait for hench's own \"started\" signal (for example the run record appearing in .hench/runs/) rather than a timer. This is more exact but needs a signal from hench.\n(c) Lengthen the phase. This is a blunt fix and slows every start."
acceptanceCriteria:
  - "When a run started by start_work later exits failed, the session's next turn tells the agent which run failed and includes the end of hench's output"
  - "A web test raises a work card, lets the run pass its starting phase, ends it with exit 1, and asserts that the next turn's prompt carries the failure"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "medium"
discoveredFrom: {"item":"c2b2b6c1-6463-4ba4-a8db-9aeff5f7e81b","run":"3c097b6f-929c-4f99-bff0-b12ed62a4f0a"}
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
