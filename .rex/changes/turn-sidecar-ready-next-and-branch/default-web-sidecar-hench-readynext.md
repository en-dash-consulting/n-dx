---
id: "f9e33d0a-b367-4bfa-b63a-2d3986f6555d"
type: "task"
title: "Default web.sidecar, hench.readyNext and git.branchHealth to on in the registry and the viewer"
slug: "default-web-sidecar-hench-readynext"
description: "Flip the three defaults in FEATURE_REGISTRY and every viewer useFeatureToggle fallback for them, update the docs, and update the tests that assume the old defaults. Keep the route gates and the toggle reads in place: only the default changes."
acceptanceCriteria:
  - "GET /api/features reports the three as enabled when nothing is stored"
  - "Storing false for each still hides its UI and makes its routes answer 403"
  - "The web test suite passes"
priority: "high"
tags:
  - "feature-flags"
  - "sidecar"
source: "ndx-capture"
---
