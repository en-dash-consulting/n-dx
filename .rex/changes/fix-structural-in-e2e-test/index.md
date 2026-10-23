---
id: "98d8a394-b9e6-4248-a2f0-4bf288b1f44e"
type: "change"
title: "Fix structural in e2e-test-infrastructure (1 finding)"
slug: "fix-structural-in-e2e-test"
intent: "- Production entry points (assistant-assets/index.js, packages/core/assistant-integration.js) are grouped into the same zone as test files, suggesting community detection is coupling asset-generation scripts to the test suite via shared import paths."
touches:
  - "56f47d3d-d39d-4938-9923-b3735656ba7b"
priority: "high"
source: "sourcevision"
---
