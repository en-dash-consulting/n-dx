---
id: "af2a209a-d1d4-48d5-aaee-7ecb4a33565c"
type: "capability"
title: "SourceVision Enrich & Core Reviewer Prompt Tightening"
slug: "sourcevision-enrich-core-reviewer"
statement: "SourceVision sends static enrichment, classification and primer prompts to a model per batch and per zone, and core sends a reviewer prompt from its pair-programming flow."
criteria: [{"id":"c1","text":"The first-pass and later-pass enrichment prompts shall share their common instruction text instead of restating it."},{"id":"c2","text":"The later-pass enrichment prompt shall state how it differs from the first pass explicitly, not by duplicating the first-pass text."},{"id":"c3","text":"The classification prompt shall state one unambiguous intent and one output contract."},{"id":"c4","text":"The primer prompt shall state one unambiguous intent and one output contract."},{"id":"c5","text":"The classification and primer prompts shall contain no instruction that contradicts the archetype definitions the classifier enforces in code."},{"id":"c6","text":"When ndx analyze --deep runs on a representative project, SourceVision shall produce zone summaries, findings and classifications equivalent to those produced by the earlier prompts."}]
requirements: [{"id":"af2a209a-d1d4-48d5-aaee-7ecb4a33565c:c1","title":"The first-pass and later-pass enrichment prompts shall share their common instruction text instead of restating it","description":"Linked to: packages/sourcevision/tests/unit/analyzers/prompt-output-contract.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The first-pass and later-pass enrichment prompts shall share their common instruction text instead of restating it."]}]
tags:
  - "prompts"
  - "sourcevision"
  - "core"
  - "tokens"
source: "ndx-capture"
priority: "medium"
---

Cover the remaining two packages that send prompts to a model. SourceVision holds roughly 1,997 tokens of static prompt text across 12 literals in its enrichment and classification pipeline: analyzers/enrich-batch.ts (buildFirstPassPrompt and buildLaterPassPrompt, ~827 tokens), enrich-config.ts (buildMetaPrompt, ~635), enrich-per-zone.ts (~454), classify.ts (buildLLMClassifyPrompt), and primer.ts (buildPrimerPrompt). These run per batch and per zone rather than once per command, so their cost multiplies with project size — the reduction compounds where rex's does not. Core holds a single surface, pair-programming.js buildReviewerPrompt at ~259 tokens, notable because it sits in the orchestration tier which is otherwise spawn-only; confirm the prompt belongs there or move it rather than leaving it as an unexamined exception.
