---
id: "24cea926-bfd0-4242-9546-bb84c0254be3"
level: "task"
title: "Dashboard token-usage aggregation has no per-model split, so dashboard costs still price everything at Sonnet rates"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "Follow-up to task e4ab52b8 (per-model cost pricing). Per-model pricing landed in rex: AggregateTokenUsage now carries a byModel split and estimateCost prices each bucket at its own rates. packages/web/src/server/routes-token-usage.ts keeps a standalone copy of the aggregation (it has a fourth 'web' package bucket for dashboard Ask spend that rex's shape does not model, which is why it was not unified in the same pass). Its local DEFAULT_PRICING literal is gone - it now resolves FALLBACK_MODEL_PRICING from @n-dx/llm-client, so there is one price table - but its own extraction never populates a per-model split, so every dashboard token still lands on the fallback Sonnet rate. Result: ndx usage and the dashboard now quote different figures for the same runs, which is what tests/unit/token-pricing-parity.test.js exists to prevent (that test currently guards the shared table, not the per-model arithmetic). Work: populate byModel in the web aggregation from the same hench turnTokenUsage records rex reads; decide how the web Ask bucket attributes its model (.n-dx-web-usage.jsonl already records vendor and model per call); price through estimateCost's per-model path. Consider unifying the two aggregations behind the rex gateway instead - the parity test's own header calls that the deeper fix. Acceptance: (1) web aggregation populates a per-model split from hench turnTokenUsage and the web usage ledger; (2) dashboard and ndx usage quote the same total for the same run set, asserted by a test; (3) dashboard labels unattributed tokens and unknown model ids as the CLI does; (4) token-pricing-parity.test.js pins the per-model arithmetic, not only the shared rate table."
lastModified: "2026-09-09T22:13:30.790Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
