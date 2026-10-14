---
id: "6e43db3d-aa74-4b57-8699-3d3520fac4ae"
level: "task"
title: "Live scan-quality measurement with a Jev route, on caos and n-dx"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
acceptanceCriteria:
  - "A keyed `sv analyze --deep` run on caos and on n-dx, with name-fallback counts before and after recorded in this item's log"
  - "Share of findings outside the uncertain band recorded for both repositories, heuristic (before) against typed (after)"
  - "Heuristic-vs-typed Noul agreement rate recorded, with a stated decision to keep or move TYPED_ARTIFACT_MAX_PROBABILITY and TYPED_REAL_MIN_PROBABILITY"
  - "Declared-rule findings on n-dx reviewed by hand; any false positive either fixed or the rule-extraction prompt tightened"
description: "The four scan-quality changes (symbol evidence, name candidates, typed anchored findings, declared-rule checks) landed under ed9a4a88 with unit coverage and a deterministic measurement on n-dx: findings with anchors went 0 -> 41, and the new name-candidate sources fire on 32 / 16 / 8 of 42 zones. The figures that need an actual judgment route were not produced, because the implementing session had no TYPESAFE_API_KEY and its sandbox could not reach a caos checkout.\n\nRun `sv analyze --deep` on caos and on n-dx with TYPESAFE_API_KEY exported, and record in this item's log:\n\n- Name fallbacks needed, before and after. \"Before\" is the generated-name fallback count on the commit prior to the candidate change; \"after\" is the same run with the symbol / README / package-description candidates. The baseline to beat is caos, where 23 of 25 zones answered `none` on directory candidates alone.\n- Share of findings outside the uncertain band, before and after. The baseline is caos, where 41 of 41 heuristic findings landed inside it. \"After\" is the typed findings, whose evidence is edges rather than a metric.\n- The heuristic-vs-typed Noul agreement rate per zone, which is what the bands should be set from. `noulAgreement` in typed-findings.ts computes it and `analyzeZones` already prints `[judge] noul agreement: N/M zones (P%)`. TYPED_ARTIFACT_MAX_PROBABILITY and TYPED_REAL_MIN_PROBABILITY were carried over from the heuristic judgment unchanged and should move only once this number exists.\n- Whether the declared-rule extraction finds real rules in n-dx's own CLAUDE.md, and whether any confirmed violation is one a maintainer agrees with. A false positive here is worse than silence, because the finding quotes the project's own words back at it.\n\nEverything needed is instrumented already; this is a measurement run, not new code — unless the numbers say a band or a threshold should move."
lastModified: "2026-10-14T16:25:24.074Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
