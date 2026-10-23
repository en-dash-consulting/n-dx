---
id: "79bebf9f-1463-4767-a932-958541d1558e"
type: "task"
title: "A failing Maven property chain is re-walked, quadratically, for every reference"
slug: "a-failing-maven-property-chain-is-re"
description: "Found by the adversarial review of ab502e66 (memoise and cap Maven property interpolation). Verdict: out-of-scope (pre-existing; the cost is identical before and after that change), high.\n\nScenario: properties p0=${p1}, …, p1499=${p1500} with p1500 undefined, and 200 dependencies whose version is ${p0}. The pom is 51 KB. readMavenBuildModels takes 7.0 s (100 deps: 3.6 s); 3,000 levels with 2,000 deps (263 KB) took 299 s. The same pom took the same time on the pre-change code.\n\nCause (packages/lang-kit/src/java-maven-build.ts, resolveProperty): only resolved values are cached, so every top-level interpolate (each dependency, group, version, Java version, BOM) re-walks the failing chain, and each level copies `seen` (new Set([...seen, name])), so one walk is O(depth²). The comment on resolveProperty, \"a failure returns straight up the chain, so it costs one walk and needs no cache\", is true per call but not per context; correct it with the fix.\n\nReachable: repository content alone, via the Java pack and sourcevision's build-model phase.\n\nOptions:\n1. Track in-progress names in the context (a Map name → \"resolving\" | BuildValue) instead of copying `seen`, and cache failures too. Cycle failures are cached under the name that closed the cycle, so the reason can name a different member of the cycle than the old code did when that member is later resolved directly; decide whether that wording change is acceptable (no fixture asserts it today). Recommended.\n2. Cache only path-independent failures (undefined, unterminated, too large) and keep `seen` for cycles. Keeps every reason identical, but a chain that ends in a cycle is still re-walked per reference.\nPairs with the depth cap in the sibling stack-overflow task; a depth cap alone bounds each walk but leaves the per-reference repetition."
acceptanceCriteria:
  - "A pom with a 1,500-deep chain ending in an undefined property, referenced by 2,000 dependencies, is read with each property resolved at most once per context (a work-count test, not a clock)"
  - "Interpolation no longer copies the visited set per level"
  - "Undefined, unterminated and too-large reasons are unchanged; existing Maven fixtures and sourcevision goldens are unchanged"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "lang-kit"
  - "review-fixes"
  - "security"
source: "ndx-adversarial-review"
---
