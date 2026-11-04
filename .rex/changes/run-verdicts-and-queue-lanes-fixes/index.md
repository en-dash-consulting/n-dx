---
id: "224cd1eb-047e-4d93-a913-148558e9fe44"
type: "change"
title: "Run verdicts and queue lanes: fixes from Hal's review of #907"
slug: "run-verdicts-and-queue-lanes-fixes"
intent: "Fixes for the four findings in Hal's adversarial review of R1 (https://github.com/en-dash-consulting/n-dx/pull/907#pullrequestreview-5770573884), each confirmed against 37bc1e26f. Run classifier (packages/hench/src/agent/analysis/run-verdict.ts): F1 a cold retry after a read-only refusal is classed claim-lost; F2 a vendor or CLI failure before the agent acts is classed no-changes, and vendor-transient never fires on default config because run.events is filled only with the event pipeline on; F3 a gate failure in test files the run did not edit is asserted pre-existing and offers close-verified. Queue planner (packages/hench/src/cli/commands/plan-queue.ts): F4 every lane's command targets the same worktree. Worktree-scoped lane commands (F4 option a) are a separate low-priority change."
acceptanceCriteria:
  - "The four findings in Hal's #907 review (F1 to F4) are fixed, each with a test that reproduces it"
  - "Verdict class ids and the queue plan's JSON shape stay compatible; only fields are added"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
  - "6b0c3873-5607-4adc-9027-abd8d70ab0e3"
priority: "high"
source: "pr-review"
discoveredFrom: {"item":"eef3d129-ffc2-4598-bfce-a30c88faf4ef"}
---
