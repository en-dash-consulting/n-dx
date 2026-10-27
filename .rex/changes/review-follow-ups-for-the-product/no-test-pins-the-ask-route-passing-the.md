---
id: "226950ea-6468-4a33-8c69-66db6e7312a8"
type: "task"
title: "No test pins the Ask route passing the v2 merge rule to parseAnswerRefinements"
slug: "no-test-pins-the-ask-route-passing-the"
description: "Verdict: should-fix (adversarial review of 81bac3da4, run 7ba3ffa9). packages/web/src/server/routes-sourcevision-ask.ts:666 sets changeLayer = isChangeLayerStore(store) and :750 passes { changeLayer } to parseAnswerRefinements. The unit tests in routes-rex-v2-items.test.ts call parseAnswerRefinements directly with { changeLayer: true }, so dropping or mis-deriving the flag in the route (e.g. a refactor back to `parseAnswerRefinements(result.text, prdDoc)`) passes every test, and on a v2 project the Ask panel again offers merges that apply then refuses (the 4965aeda defect). Reachable through POST /api/sourcevision/ask in refine mode on a v2 project. Fix: in routes-sourcevision-ask.test.ts, on a copy of packages/rex/tests/fixtures/v2-tree, inject createClient answering a refinement block that merges the amending change into a sibling; assert the response has no merge proposal and a note matching /carries amendments/. Small; one test, no source change."
acceptanceCriteria:
  - "On a v2 copy, POST /api/sourcevision/ask in refine mode with a stubbed model answer merging the amending change returns no merge proposal and a note carrying 'carries amendments' (route test)"
  - "Removing { changeLayer } from the route's parseAnswerRefinements call fails that test"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "v2-hardening"
source: "ndx-adversarial-review"
---
