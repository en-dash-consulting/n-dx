---
id: "8d4bc360-ea71-46eb-a79a-ff4a698bdd62"
level: "feature"
title: "Stack review fixes: pre-merge (PR 21)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "ci"
  - "release-notes"
  - "pr-21"
blockedBy:
  - "dd9c5ff1-38fe-4dea-8b31-ebc9271f8a37"
source: "review"
startedAt: "2026-10-17T18:44:51.045Z"
endedAt: "2026-10-20T15:28:31.833Z"
acceptanceCriteria:
  - "Build & Validate and Tests (Windows, rex+sourcevision) pass on the PR 21 head"
  - "A markerless repository with JS only in a TypeScript-skipped directory is detected and inventoried consistently"
  - "The changesets describe the shipped detection rule, the inventory fingerprint, and only the linearity actually delivered"
  - "One unreadable or malformed Java build file no longer degrades the whole Java pack"
description: "The six findings from the 2026-10-17 re-review (round 2) of #822–#825 that Ryan triaged as must land before the stack merges; the rest are deferred to issues #826–#831. Three of them turn required CI checks green on run 39028377207 (Build & Validate; Tests (Windows, rex+sourcevision)). Stacked on #825 (PR 20), branch feat/sv-lang-pr21-premerge-fixes. #823–#825 merge together, and PR 21 goes with them.\n\nReviews: https://github.com/en-dash-consulting/n-dx/pull/822#pullrequestreview-5559040488, https://github.com/en-dash-consulting/n-dx/pull/825#pullrequestreview-5559040931."
lastModified: "2026-10-20T16:58:58.459Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Bound the inflated size of an sv pack bundle before reading it](./bound-the-inflated-size-of-an-sv-pack.md) | completed |
| [Contain build-file read failures in the Java resolver's forProject](./contain-build-file-read-failures-in.md) | completed |
| [Correct the language-pack release notes before the stack merges](./correct-the-language-pack-release.md) | completed |
| [Count fallback source with the skip set of the Terraform-alone result](./count-fallback-source-with-the-skip.md) | completed |
| [Escape the runner paths fully in the CI grammar-steps test](./escape-the-runner-paths-fully-in-the.md) | pending |
| [Keep the sv pack add command out of the docs build's HTML parser](./keep-the-sv-pack-add-command-out-of.md) | completed |
| [Make the Python env-key and route-prefix helpers linear on any input](./make-the-python-env-key-and-route.md) | completed |
| [Make the Spring Boot name and route-path helpers linear on any input](./make-the-spring-boot-name-and-route.md) | completed |
| [Normalise path separators before the Terraform model test filters caches](./normalise-path-separators-before-the.md) | completed |
| [Pin the Maven and Gradle build goldens to LF so Windows checkouts match](./pin-the-maven-and-gradle-build-goldens.md) | completed |
| [Say that sv pack add --from runs the bundle's entry module while validating it](./say-that-sv-pack-add-from-runs-the.md) | completed |
| [Stop collectTree following symlinks when it bundles a pack](./stop-collecttree-following-symlinks.md) | completed |
