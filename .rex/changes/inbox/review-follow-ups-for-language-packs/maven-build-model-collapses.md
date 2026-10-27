---
id: "f34120c9-1a55-4f32-a90c-6e3a2c0c29b0"
type: "task"
title: "Maven build model collapses dependencies that differ only by type or classifier"
slug: "maven-build-model-collapses"
description: "Verdict: should-fix (severity medium), from the adversarial review of task 9c28bdc7, the Maven pom reader.\n\nFailure: packages/sourcevision/src/language/java-maven-build.ts keys both dependencies (eff.deps) and dependencyManagement (managedKey) by group:artifact only. A module that declares com.acme:core (compile) and com.acme:core with <type>test-jar</type> or <classifier>tests</classifier> (scope test) — a common multi-module pattern — keeps only the last entry. The model then reports a single com.acme:core dependency with scope test, and the compile dependency is gone. Managed entries for different classifiers likewise overwrite each other.\n\nReachability: readMavenBuildModels is in-memory only today, used by fixtures. Phase 3 attaches versions to externals, and that is where the wrong scope would surface.\n\nOptions:\n(a) Key by group:artifact:type:classifier (Maven's management key), and add optional `type` and `classifier` fields to BuildDependency in build-model.ts. This is cheap, but it changes the shared output type the Go reader mirrors, so coordinate with task db21d009. Recommended.\n(b) Key by the full tuple without new fields. The output would then hold duplicate group:artifact rows that cannot be told apart. Not recommended."
acceptanceCriteria:
  - "A module declaring g:a and g:a with classifier tests lists both dependencies, each with its own scope"
  - "dependencyManagement entries that differ only by type or classifier are applied to the matching dependency only"
  - "A unit test in tests/unit/language/java-maven-build.test.ts covers both cases"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "java"
source: "ndx-adversarial-review"
---
