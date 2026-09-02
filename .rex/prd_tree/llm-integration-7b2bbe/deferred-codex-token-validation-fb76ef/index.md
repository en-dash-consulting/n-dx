---
id: "fb76efeb-edec-49fd-8bb7-e90d64065796"
level: "feature"
title: "Deferred Codex Token Validation at End of Work Run"
status: "completed"
source: "smart-add"
startedAt: "2026-04-16T15:06:34.342Z"
completedAt: "2026-04-16T15:06:34.342Z"
acceptanceCriteria: []
description: "Currently Codex token counts are validated (e.g. against budget thresholds or parsed and surfaced) incrementally during a hench work run, which can produce premature interruptions or misleading mid-run diagnostics. The desired behavior is to accumulate raw Codex token data throughout the run and defer all validation and reporting to the run-completion phase."
---

## Children

| Title | Status |
|-------|--------|
| [Audit Codex token validation and budget-check call sites within the hench work run loop](./audit-codex-token-validation-4ac54c.md) | completed |
| [Refactor Codex token accumulation to defer validation and reporting until run completion](./refactor-codex-token-70b824.md) | completed |
