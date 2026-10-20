---
id: "41610fde-da5c-4b98-aa58-bf1b70a0ac08"
level: "task"
title: "Contain build-file read failures in the Java resolver's forProject"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "java"
  - "lang-java"
  - "resilience"
  - "pr-21"
source: "review"
startedAt: "2026-10-17T18:20:47.191Z"
completedAt: "2026-10-17T18:24:46.884Z"
endedAt: "2026-10-17T18:24:46.884Z"
resolutionType: "code-change"
resolutionDetail: "javaResolver.forProject catches readTestArtifactGrants failures, binds with NO_GRANTS and reports the error via PreparedResolver.notices(); test mocks the reader to throw."
acceptanceCriteria:
  - "When readTestArtifactGrants throws (unreadable or malformed pom.xml or Gradle script), forProject returns the no-grants resolver and the analysis records a notice naming the failure"
  - "A test makes readTestArtifactGrants fail and asserts the Java pack still produces its import edges (only cross-module test-to-test links are lost)"
  - "Java corpus report and build-model output unchanged for repositories whose build files read cleanly"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "**should-fix.** Review: https://github.com/en-dash-consulting/n-dx/pull/823#discussion_r4303693072\n\nAt the #825 head, `packages/lang-java/src/java-resolver.ts:480-483`:\n\n```ts\nasync forProject(projectDir) {\n  const grants = await readTestArtifactGrants(projectDir);\n  return { prepare: (files) => prepareJava(files, grants) };\n},\n```\n\nSince #823 this puts the Maven and Gradle readers on every Java analyze, with no containment. If `readTestArtifactGrants` throws (an unreadable build file, a malformed pom, a reader bug), `forProject` rejects and the whole Java pack degrades, dropping every Java edge, when only the test-jar and test-fixtures grants were at stake.\n\nFix: wrap the call in try/catch. On failure, use `NO_GRANTS` (already the default for `prepare` at line 479) and surface a notice through the pack's existing notice mechanism (see how PR 19 contained framework, project-facts and symbol-refine failures as notices, and reuse that path), naming the build file or error. Do not swallow silently. Add a unit test that forces the failure (e.g. a stubbed reader, or a fixture with an unreadable build file) and asserts imports still resolve and the notice appears.\n\nOut of scope (deferred to #827): grants from build files below the repo root, Gradle `sourceSets.test.output`, and the Kotlin `?` continuation bug."
lastModified: "2026-10-17T18:24:47.205Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
