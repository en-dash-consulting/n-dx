---
id: "70b824a2-9dfd-440f-8e89-576a8e0fc586"
type: "change"
title: "Refactor Codex token accumulation to defer validation and reporting until run completion"
slug: "refactor-codex-token-accumulation-to"
intent: "Move Codex token validation (budget checks, count assertions, and quota logging) out of the per-turn loop and into the post-run summary phase. The per-turn path should only accumulate raw token counts; validation and user-facing diagnostics fire once at the end of the full work run. Ensure the existing mid-run quota log formatter still receives final totals at run end."
acceptanceCriteria:
  - "No Codex token validation or budget-threshold checks fire before the run-completion handler"
  - "Raw Codex token counts are correctly accumulated across all turns within a single work run"
  - "End-of-run validation receives the correct cumulative totals, not per-turn values"
  - "Existing quota status log output still appears once at run end, not per turn"
  - "No regressions in token attribution or run summary fields"
touches:
  - "fb76efeb-edec-49fd-8bb7-e90d64065796"
priority: "high"
tags:
  - "codex"
  - "tokens"
  - "hench"
  - "refactor"
source: "smart-add"
---
