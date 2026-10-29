---
id: "89ea9636-36b9-433e-bc99-0981a1c6b1ee"
type: "change"
title: "Bound vendor CLI sessions by turns and spend"
slug: "bound-vendor-cli-sessions-by-turns-and"
intent: "On the CLI provider path a vendor session has no wall-clock timeout, no turn cap and only a post-hoc token budget; Ctrl-C does not kill the in-flight CLI; Claude tool results are not recorded and the guard's audit summary is discarded at run end."
acceptanceCriteria:
  - "The Claude adapter passes --max-turns from maxTurns and the Codex adapter an equivalent turn cap; a guard.spawnTimeout timer terminates the vendor process tree"
  - "hench.maxCostUsdPerRun and hench.maxCostUsdPerDay are enforced before each spawn from the run ledger and MODEL_COSTS, and a run that would exceed them stops with status budget_exceeded"
  - "SIGINT and SIGTERM abort the in-flight vendor CLI through the spawn's AbortController, covered by a test"
  - "Claude stream-json tool results are mapped into the run record and the PolicyEngine audit summary and session counters are persisted on the run record"
touches:
  - "7dcba8e2-05e4-42bd-9172-4e146c692916"
priority: "medium"
source: "ndx-capture"
---
