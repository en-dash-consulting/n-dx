---
id: "b58a7985-5a14-4deb-b117-7d29d009a3a7"
type: "task"
title: "Default hench.runVerdict to on"
slug: "default-hench-runverdict-to-on"
description: "Set defaultValue to true in FEATURE_REGISTRY and the useFeatureToggle fallback in run-verdict-banner.ts; update tests that assume it is off."
acceptanceCriteria:
  - "A failed run's task shows the verdict banner with nothing stored"
  - "Storing false hides it"
priority: "low"
tags:
  - "feature-flags"
source: "ndx-capture"
---
