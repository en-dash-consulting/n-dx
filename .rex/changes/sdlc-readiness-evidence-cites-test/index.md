---
id: "7a93a121-aa1c-45ee-86a9-e2f4a4e1a6a4"
type: "change"
title: "SDLC readiness evidence cites test fixture files"
slug: "sdlc-readiness-evidence-cites-test"
intent: "sdlc-profile's walkProject descends into fixture trees, so manifests that only exist as test inputs count as the repository's own evidence. On n-dx, the Testing dimension cites packages/sourcevision/tests/fixtures/go-project/go.mod, tests/fixtures/sdlc/node-helm-prisma-launchdarkly/package.json and others. The Delivery & infrastructure panel (PR #838) now shows this evidence, so the fake paths are visible to users and can inflate scores. Infrastructure discovery already skips these trees (9c2fd3e42); the walk should share that list rather than restate it. tests/ itself cannot be skipped: real test files there are testing evidence."
acceptanceCriteria:
  - "walkProject does not descend into fixtures, __fixtures__, testdata or __mocks__ directories, matched in any case"
  - "Test files under tests/ are still walked and still count as testing evidence"
  - "The fixture directory list is defined once and shared with infrastructure discovery"
  - "Analysing n-dx produces no readiness evidence path under a fixtures directory"
  - "A regression test covers a manifest inside a fixture directory"
touches:
  - "7d36ef27-6a39-42bb-ac8f-39059ac330b2"
priority: "medium"
tags:
  - "ndx-adversarial-review"
source: "ndx-capture"
---
