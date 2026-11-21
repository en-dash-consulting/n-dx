---
id: "f9c4174d-6f33-448c-be18-49483ecc7627"
type: "task"
title: "The capture tile's grow test passes whether or not grow works"
slug: "the-capture-tile-s-grow-test-passes"
summary: "The test meant to check that the capture panel grows to fit a preview never exercises that behaviour. This replaces it with one that would catch a regression."
description: "Verdict: should-fix (severity medium, test quality), from the adversarial review of feat/capture-pane-modal.\n\ntests/unit/viewer/stage-tiles.test.ts:250 tests fitTracks(…, Infinity); fitTracks is unchanged, so the test passes on origin/main and never exercises tile.grow (stage-tiles.ts:325). The changeset's claim that a preview grows the tile has no effective coverage; jsdom has no layout, so useFitTracks returns early in unit tests.\n\nFix (cheap): a unit test that mocks getBoundingClientRect and asserts the capture tile's grid-row span exceeds its base span when content is taller, or a Playwright assertion in tests/e2e-ui/plan-preview-layout.spec.ts."
acceptanceCriteria:
  - "A test fails if the grow flag is removed from the capture tile or ignored by the tile grid"
  - "The test asserts the capture tile's row span grows when its content is taller than the base span"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
