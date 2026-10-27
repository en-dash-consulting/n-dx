---
id: "2b997e79-1594-4b57-ae69-86c92bb7fdc2"
type: "task"
title: "Allow cross-module test-to-test Java links when the module depends on the other's test jar or test fixtures"
slug: "allow-cross-module-test-to-test-java"
description: "Regression from f6446797 (\"Java test code in one module still links to another module's test classes\"), found by session verification on thingsboard. f6446797 made the Java resolver never link test code in one module to test classes in another. Maven and Gradle projects routinely share test code across modules, though:\n- **Maven:** a test-scoped dependency on another module's test jar, `<type>test-jar</type>` or `<classifier>tests</classifier>`.\n- **Gradle:** `testFixtures(project(':x'))`, or a project dependency on a test configuration such as `testArtifacts`, `testOutput` or `tests`.\n\nIn that case javac does resolve the reference. thingsboard's application/pom.xml (around line 188) declares dao with `<type>test-jar</type>` and `<scope>test</scope>`. After f6446797, thingsboard lost 352 edges, all of this kind, e.g. application/src/test/java/org/thingsboard/server/agent/AgentBulkActionAgentTest.java -> dao/src/test/java/org/thingsboard/server/dao/service/DaoSqlTest.java. The root pom, transport/lwm2m and common/transport/lwm2m also use test-jar.\n\nFix: allow a test file in module A to resolve to a test file in module B when A's build declares a test-artifact dependency on B. Read this with lang-kit's Maven and Gradle readers (java-maven-build.ts, java-gradle-build.ts / gradle-script.ts), matching B by groupId:artifactId (Maven) or project path (Gradle). Keep every other part of 94e1f85d's and f6446797's rules: own module first, never main -> test, and no cross-module test -> test without such a dependency. Gradle `java-test-fixtures` publishes src/testFixtures as its own source set; a testFixtures(project) dependency makes B's testFixtures source set visible, and its test set only if the build says so.\n\nTests: a Maven fixture with test-jar and with classifier tests, a Gradle testFixtures fixture, and a negative fixture without such a dependency (link still refused). The session re-runs thingsboard and expects those 352 edges back."
acceptanceCriteria:
  - "A test file links to another module's test classes when its module declares a test-jar (Maven type test-jar or classifier tests) or Gradle test-fixtures/test-configuration dependency on that module"
  - "Without such a dependency the cross-module test link is still refused; main never resolves to test"
  - "Maven test-jar, classifier tests, Gradle testFixtures and negative fixtures pass"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Found by session verification of PR 18 on the thingsboard corpus repo; the session re-checks thingsboard's edges after this run. The hench sandbox may block ~/.cache corpora; do not capture follow-ups for corpus checks."}
tags:
  - "review-fixes"
  - "lang-java"
  - "regression"
  - "pr-18"
source: "verification"
---
