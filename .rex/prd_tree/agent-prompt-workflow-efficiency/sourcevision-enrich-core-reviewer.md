---
id: "af2a209a-d1d4-48d5-aaee-7ecb4a33565c"
level: "feature"
title: "SourceVision Enrich & Core Reviewer Prompt Tightening"
status: "pending"
priority: "medium"
tags:
  - "prompts"
  - "sourcevision"
  - "core"
  - "tokens"
blockedBy:
  - "6a4c8eac-7d3c-4535-a983-808cd9e04fbb"
source: "ndx-capture"
acceptanceCriteria:
  - "The first-pass and later-pass enrichment prompts share their common instruction text rather than restating it, and the difference between the two passes is stated explicitly rather than implied by duplication."
  - "Per-batch and per-zone prompts are trimmed with the multiplication factor in mind: the criteria record cost per batch and per zone, not only cost per invocation, since these scale with project size."
  - "The classification prompt and the primer prompt each state one unambiguous intent and one output contract, with no instruction that contradicts the archetype definitions the classifier already enforces in code."
  - "The core buildReviewerPrompt is either justified as a legitimate exception to the orchestration-tier spawn-only rule or relocated, with the decision recorded rather than left implicit."
  - "Total sourcevision static prompt text drops measurably against the recorded baseline, with per-builder before-and-after counts reported."
  - "Enrichment output quality is unchanged: running ndx analyze --deep on a representative project yields equivalent zone summaries, findings, and classifications to the pre-rewrite run."
  - "Existing sourcevision and core tests pass, including the iso-skill-drift check."
description: "Cover the remaining two packages that send prompts to a model. SourceVision holds roughly 1,997 tokens of static prompt text across 12 literals in its enrichment and classification pipeline: analyzers/enrich-batch.ts (buildFirstPassPrompt and buildLaterPassPrompt, ~827 tokens), enrich-config.ts (buildMetaPrompt, ~635), enrich-per-zone.ts (~454), classify.ts (buildLLMClassifyPrompt), and primer.ts (buildPrimerPrompt). These run per batch and per zone rather than once per command, so their cost multiplies with project size — the reduction compounds where rex's does not. Core holds a single surface, pair-programming.js buildReviewerPrompt at ~259 tokens, notable because it sits in the orchestration tier which is otherwise spawn-only; confirm the prompt belongs there or move it rather than leaving it as an unexamined exception."
lastModified: "2026-09-08T13:41:14.076Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
