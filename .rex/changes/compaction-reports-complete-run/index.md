---
id: "2563f037-9cac-4d1e-b9e5-e7ba7e4c0927"
type: "change"
title: "Compaction reports complete run accounting when summary usage is missing or partial"
slug: "compaction-reports-complete-run"
intent: "A direct OpenAI run with otherwise measured turns receives a successful summary with no usage or only prompt_tokens. packages/hench/src/agent/lifecycle/context-prune.ts drops the provider usageStatus. recordPruneUsage in loop.ts omits the summary row or records a zero output with no diagnostic status. The run then reports complete coverage. This also occurs on pre-existing pinned Responses summaries. Carry the existing provider usage status through the pruner to the per-turn ledger, retaining known counters and distinguishing an unmeasured completed call from a prune that never called the provider. The change is local to summary accounting and needs regression coverage for the ordinary no-prune path. Review severity medium, verdict out-of-scope."
acceptanceCriteria:
  - "When a successful summary has no usage and other turns have measured usage, the run records an unavailable summary row against its resolved model and reports unavailable usage coverage."
  - "When a successful summary reports only 12 prompt tokens, the run retains those tokens and reports partial coverage for the summary and the run."
  - "An integration regression exercises both responses through real compaction and checks that turns that did not call the summarizer add no summary row."
touches:
  - "05338f33-e638-49b8-815f-ed12949f0c63"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
