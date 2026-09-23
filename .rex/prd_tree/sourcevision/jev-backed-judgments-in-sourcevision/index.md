---
id: "6a8f9616-59f0-458f-8e56-45abbb00a3da"
level: "feature"
title: "Jev-backed judgments in sourcevision"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
source: "ndx-capture"
startedAt: "2026-09-22T03:25:01.355Z"
endedAt: "2026-09-22T04:42:25.346Z"
acceptanceCriteria:
  - "With TYPESAFE_API_KEY set, `ndx analyze --deep .` on this repository completes and the classify pass reports Jev as the model used"
  - "With TYPESAFE_API_KEY unset, `ndx analyze --deep .` produces output byte-identical to main for classifications and findings, plus at most one notice line naming the fallback"
  - "Zone names, descriptions, insights and CONTEXT.md are still produced by the configured llm.vendor in both modes"
  - "`llm.routes[\"code.classify\"] = \"light\"` returns classification to the vendor's light tier even when the key is present"
  - "`LLM_VENDOR` in @n-dx/llm-client is unchanged and `ClaudeClient.complete` has no Jev implementation"
description: "Sourcevision makes five LLM calls. Four are generative — zone names, descriptions and insights (`zone.enrich-scan`/`zone.enrich-deep` in `analyzers/enrich-batch.ts`, the per-zone fallback in `analyzers/enrich-per-zone.ts`), meta-evaluation (`zone.meta-eval`), and the CONTEXT.md distill (`context.distill` in `cli/commands/analyze.ts`). One is a judgment: `code.classify` in `analyzers/classify.ts` picks an archetype id from a fixed catalog, and today does so by asking for free-text JSON, validating each item, stamping every result with `confidence: 0.7`, and carrying a three-attempt prompt-degradation ladder that exists only because free text can come back malformed.\n\nTypeSafe's Jev (a System One model; `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`) returns typed answers — `choice` over up to 255 options, `noul` yes/no probability, `score` over 2–10 ordered levels — with a per-option probability distribution and a confidence value. It does not generate text, so it cannot replace the four generative calls; it is a direct fit for classification, and for the judgment-shaped fields (finding severity, finding category, zone fragility) that the generative prompts are currently asked to produce alongside prose.\n\nThis feature routes sourcevision's judgment-shaped calls to Jev and leaves generation on the configured vendor. Opt-in is `TYPESAFE_API_KEY` present in the environment; `llm.routes[\"<task class>\"]` in `.n-dx.json` can send a class back to a tier (e.g. `\"light\"`) or name `\"typesafe\"` explicitly. With no key, every path falls back to the current vendor and prints one notice line — output is otherwise identical to today. No new vendor is added to `LLM_VENDOR`, and `ClaudeClient.complete` is untouched: Jev is not a completion provider and does not pretend to be one."
lastModified: "2026-09-22T04:42:28.074Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Background narration lifecycle: re-queue superseded work, visible in ndx status and the dashboard, ndx plan waits](./background-narration-lifecycle-re.md) | completed |
| [Cascade follow-ups: heuristic real-problem Noul, move-file Choice, escalation band tuning, --per-zone passthrough](./cascade-follow-ups-heuristic-real.md) | completed |
| [Cascade re-run idempotence: no repeated name fallbacks, unchanged escalated zones carried forward, stable judgment keys, naming progress](./cascade-re-run-idempotence-no-repeated.md) | completed |
| [Cascade robustness: model-alias expansion and config warning, visible CLI errors, ladder stops on non-retryable failures, --full skipped after the cascade, naming progress and concurrency](./cascade-robustness-model-alias.md) | deferred |
| [Finding cascade: Jev gates, verifies and anchors enrichment; free-text generation becomes --narrate](./finding-cascade-jev-gates-verifies-and.md) | completed |
| [Finding severity, finding category and zone fragility as Jev judgments](./finding-severity-finding-category-and.md) | completed |
| [Iso map: expand areas in place, several at once, instead of only opening one area on its own](./iso-map-expand-areas-in-place-several.md) | completed |
| [Jev client and code.classify as a Choice over the archetype catalog](./jev-client-and-code-classify-as-a.md) | completed |
| [Partition balance and nesting: lopsided subdivisions count as failures, oversized zones flagged, tests grouped with their code, iso map draws sub-zones](./partition-balance-and-nesting-lopsided.md) | completed |
| [Partition review: Jev and health signals decide whether a previous partition may be reused or seed Louvain; upgrades re-partition without sv reset](./partition-review-jev-and-health.md) | completed |
| [Re-run judgments: Jev decides what needs re-enrichment and which findings still hold](./re-run-judgments-jev-decides-what.md) | pending |
| [Route-aware partitioning: detect file-based routing, treat route directories as generic, group route modules by route subtree](./route-aware-partitioning-detect-file.md) | completed |
| [Scan quality: symbol evidence, symbol/README name candidates, typed anchored findings, declared-rule checks](./scan-quality-symbol-evidence-symbol.md) | pending |
| [Scan speed: one generation call per kind, narration off the critical path](./scan-speed-one-generation-call-per.md) | completed |
| [Zone areas: a top level of 4–10 areas over the fine zones, tests join the area they test, iso map shows areas with drill-in](./zone-areas-a-top-level-of-410-areas.md) | completed |
| [Zone identity: ids from the deepest distinguishing directory, clean filename ids, sub-zone ids follow their parent, stale fallback names not treated as chosen, numeric-suffix ids follow verified names](./zone-identity-ids-from-the-deepest.md) | completed |
