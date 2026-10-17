---
id: "3b3f2676-eb6a-4d47-9c3c-8560f50c2dd6"
level: "task"
title: "A same-package Java name visible only in another module's test code shadows the wildcard import javac would use"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-java"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test file whose same-package name is declared only in another module's test set, and which wildcard-imports a package that declares that name in visible code, links to the wildcard's declaration (fixture in java-resolver.test.ts)"
  - "A main file whose same-package name is declared only in test code falls through to its wildcard import in the same way"
  - "Java golden unchanged"
description: "Found by the adversarial review of f6446797, the change that filters out other modules' test candidates. Verdict: should-fix, low.\n\nScenario: take svc-a/src/test/java/com/acme/svc/SvcTest.java in package com.acme.svc. It has `import com.acme.util.*;` and uses `Helper`. The project has svc-b/src/test/java/com/acme/svc/Helper.java and svc-a/src/main/java/com/acme/util/Helper.java. javac cannot see svc-b's tests, so it resolves Helper through the wildcard to util.Helper. In packages/lang-java/src/java-resolver.ts, `resolveSimple` stops at the same-package level and returns true whenever `index.topLevel` has the name. `Collector.file` then filters every candidate out through `visibleCandidates`. The result: no edge at all, and the real edge to util.Helper is missed.\n\nThe same pattern exists from before this change for main code: a main referencer whose same-package name is declared only in test code also loses its wildcard match. f6446797 extends it to test referencers. Every result is a dropped edge, never a wrong one.\n\nReachable through sv analyze on multi-module Maven/Gradle repos. It needs three things together: the same simple name in the same package in another module's tests, a wildcard import of a different package, and that package declaring the name. That combination is rare.\n\nFix: have `Collector.file` return whether any visible candidate remained. In `resolveSimple`, fall through to the wildcard imports when the same-package candidates are all invisible. Single-type imports and fully qualified names need no change, because javac reports an error for those. Cost: a few lines plus a fixture. Risk: low."
lastModified: "2026-10-17T07:40:54.572Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
