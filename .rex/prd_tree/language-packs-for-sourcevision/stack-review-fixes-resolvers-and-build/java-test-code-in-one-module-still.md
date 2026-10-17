---
id: "f6446797-132d-4560-9b69-ed946393e949"
level: "task"
title: "Java test code in one module still links to another module's test classes"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-java"
source: "ndx-adversarial-review"
startedAt: "2026-10-17T07:38:48.035Z"
completedAt: "2026-10-17T07:42:44.954Z"
endedAt: "2026-10-17T07:42:44.954Z"
resolutionType: "code-change"
resolutionDetail: "Test referencers no longer see other modules' test-set candidates (option a); fixture added; commit 20bc9d8a6."
acceptanceCriteria:
  - "A test file in module A that names a class declared only in module B's test source set gets no file edge to it (fixture in java-resolver.test.ts)"
  - "A test file in module A still links to module B's main declaration of a name"
  - "Java corpus: edges only removed relative to the previous resolver"
description: "Found by the adversarial review of 94e1f85d (d0072072c).\n\nScenario: in packages/lang-java/src/java-resolver.ts, visibleCandidates drops test candidates only for a main-code referencer. Take svc-a/src/test/java/com/acme/FooTest.java, which uses TestUtils, where TestUtils is declared only in svc-b/src/test/java/com/acme/TestUtils.java. visible.length <= 1 returns that candidate, so the resolver adds an edge from svc-a's tests to svc-b's tests. The same happens on fan-out: with candidates svc-b/src/test Helper and svc-c/src/main Helper, it links to both. Task 94e1f85d's description says \"test code in the same module may see test code\", so cross-module test-to-test edges are the false coupling that task targeted. They can still merge test zones across services.\n\nReachable: sv analyze on any multi-module Maven/Gradle repo whose modules share package names, as thingsboard's do.\n\nNot covered: the 94e1f85d fixtures pin main->test and cross-module main code only.\n\nDecision for the operator: Maven test-jar and Gradle testFixtures dependencies let one module's tests legitimately compile against another's. Options:\n(a) drop other-module test-set candidates for a test referencer: cheap, a 2-line filter plus a fixture; risks losing real test-jar edges;\n(b) keep them only when the module's build file declares a test-jar or testFixtures dependency: needs the forProject hook and build reading, a larger cost.\nRecommend (a); testFixtures is already a separate source set, so it matches the module-local rule."
lastModified: "2026-10-17T07:42:45.270Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
