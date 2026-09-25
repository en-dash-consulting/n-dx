---
id: "117b0560-2dd0-4c5d-9f7d-5149eb7e3318"
level: "task"
title: "Finding severity, finding category and zone fragility as Jev judgments"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
blockedBy:
  - "6c302b20-92d4-43ff-833d-74a62b9fc72b"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test with mocked Jev answers: severity and category on new findings come from Jev when confidence clears the threshold, and Finding.confidence is populated"
  - "Unit test: below-threshold Jev answers leave the model-stated severity and classifyFinding-derived category in place"
  - "Unit test: enforceSeverityRules still downgrades findings after Jev has set severity"
  - "Unit test: zone fragility nouls above threshold produce structural observation findings carrying the probability as confidence; below threshold produce nothing"
  - "Unit test: with TYPESAFE_API_KEY unset, enrichment prompts are string-identical to main and no Jev request is made"
  - "Unit test: with the route active, the enrichment output section no longer contains the severity/category contract text"
  - "Manual: `ndx analyze --deep .` on this repository with the key set writes .sourcevision/zones.json whose findings carry confidence values, and the run's token report includes finding.judge and zone.judge usage"
  - "`pnpm --filter @n-dx/sourcevision test` passes"
description: "Pull the judgment-shaped fields out of the generative enrichment prompts and ask Jev for them, using the client and routing from the preceding task. Add task classes `finding.judge` and `zone.judge` to `DEFAULT_JUDGMENT_ROUTES`.\n\nFindings. After `extractFindings` in `analyzers/enrich-parsing.ts` and before `enforceSeverityRules`, batch the new findings into one Jev request: `state` is the findings keyed by index (text, scope, related zones/files, finding type); per finding a `score` question for severity over three concrete levels (info: an observation with no action implied / warning: a maintainability or boundary problem that will cost time if left / critical: a defect, data-loss or security exposure that needs fixing now) and a `choice` question for category over `structural | code | documentation` with `what`/`not_for` criteria drawn from the existing doc comment on `FindingCategory`. Jev's severity replaces the model-stated one only when its confidence clears a threshold set in code; category likewise, falling back to the keyword-based `classifyFinding` when Jev is unavailable or unsure. Store the answer's confidence in `Finding.confidence`, which the schema already defines and nothing currently fills. `enforceSeverityRules` still runs last and still wins.\n\nZones. For each zone sent to enrichment, ask two `noul` questions over the zone's file list and its crossing summary: whether the zone's files serve unrelated purposes (low cohesion, as an architectural judgment rather than the graph metric), and whether the zone depends on more of the rest of the codebase than it should for its size. Emit each as a pass-scoped `observation` finding with `category: \"structural\"` and `Finding.confidence` = the noul probability, only when the probability clears a threshold. These sit alongside — not instead of — the Louvain cohesion/coupling numbers.\n\nPrompts. When the Jev route is active, `enrich-batch.ts` and `enrich-per-zone.ts` drop the `findingsContract(withCategory)` request for `severity`/`category` from the output section, so the generative model is not asked to produce values that Jev supplies; when inactive, prompts are unchanged. `logSvPromptSections` should show the smaller output section."
lastModified: "2026-09-22T02:08:55.686Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
