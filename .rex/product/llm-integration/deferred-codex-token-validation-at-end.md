---
id: "fb76efeb-edec-49fd-8bb7-e90d64065796"
type: "capability"
title: "Deferred Codex Token Validation at End of Work Run"
slug: "deferred-codex-token-validation-at-end"
statement: "Hench accumulates raw Codex token counts across every turn of a work run and runs all Codex token validation, budget checks and quota reporting once, when the run completes."
criteria: [{"id":"c1","text":"While a work run is in progress, hench shall only accumulate raw Codex token counts and shall not run any Codex token validation or budget-threshold check before the run-completion handler."},{"id":"c2","text":"Hench shall accumulate raw Codex token counts across all turns within a single work run."},{"id":"c3","text":"When a work run completes, hench shall validate Codex tokens against the cumulative totals for the whole run, not per-turn values."},{"id":"c4","text":"When a work run completes, hench shall emit the quota status log output once with the run's final totals, and shall not emit it per turn."},{"id":"c5","text":"Hench shall keep token attribution and run summary fields populated with the accumulated Codex token totals at run end."}]
requirements: [{"id":"fb76efeb-edec-49fd-8bb7-e90d64065796:c4","title":"When a work run completes, hench shall emit the quota status log output once with the run's final totals, and shall not emit it per turn","description":"Linked to: packages/hench/tests/integration/quota-log-output.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a work run completes, hench shall emit the quota status log output once with the run's final totals, and shall not emit it per turn."]}]
source: "smart-add"
---

Currently Codex token counts are validated (e.g. against budget thresholds or parsed and surfaced) incrementally during a hench work run, which can produce premature interruptions or misleading mid-run diagnostics. The desired behavior is to accumulate raw Codex token data throughout the run and defer all validation and reporting to the run-completion phase.
