---
id: "fa5a515b-61f6-4891-8aac-86c6e7e61c59"
type: "task"
title: "A deep Maven property chain overflows the call stack and rejects readMavenBuildModels"
slug: "a-deep-maven-property-chain-overflows"
description: "Found by the adversarial review of ab502e66 (memoise and cap Maven property interpolation). Verdict: out-of-scope (pre-existing, identical before and after that change), high.\n\nScenario: a pom whose properties form a linear chain p0=${p1}, p1=${p2}, …, p4999=${p5000}, p5000=x, with a dependency version ${p0}. The pom is 112 KB, well under the 1 MiB build-file cap. interpolate → resolveProperty recurses once per level (packages/lang-kit/src/java-maven-build.ts, interpolate/resolveProperty), and around 3,000–5,000 levels (JIT-dependent) Node throws RangeError: Maximum call stack size exceeded. Nothing catches it: readMavenBuildModels rejects, and with it lang-java's java-test-artifacts.ts (mavenGrants) and sourcevision's build-model phase. Measured on the pre-change code and on 3ff3de131: depth 3000 resolves, depth 5000 and 8000 throw, in both.\n\nReachable: any repository analysed by sourcevision with the Java pack, from repository content alone.\n\nOptions:\n1. Cap the property nesting depth (e.g. 64; Maven poms nest a handful of levels) and return { resolved: false, reason: \"property nesting too deep\" }. Cheap, one check plus a test; recommended.\n2. Rewrite resolution iteratively with an explicit stack. Removes the limit entirely but is more code for no real-world gain."
acceptanceCriteria:
  - "A pom with a 10,000-deep linear property chain returns a model whose version is unresolved with a named reason instead of rejecting readMavenBuildModels"
  - "A lang-kit unit test covers the deep chain and fails on the current code with a RangeError"
  - "Existing Maven fixtures and sourcevision Maven goldens are unchanged"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "lang-kit"
  - "review-fixes"
  - "security"
source: "ndx-adversarial-review"
---
