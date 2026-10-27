---
id: "e6ce4e7e-10ec-4a5c-b9aa-a2ba08cbbd1c"
type: "change"
title: "Go build reader throws when a project subdirectory is unreadable"
slug: "go-build-reader-throws-when-a-project"
intent: "Verdict: should-fix (low). packages/sourcevision/src/language/go-build.ts findDirsWith (walk) calls readdir with no error handling, so a subdirectory that cannot be listed makes readGoBuildModels / readGoWorkFiles throw. The task contract says unreadable files become notices and the reader never throws. Scenario: a repository with a chmod 000 directory (or one that is deleted mid-walk, ENOENT) → readGoBuildModels(projectDir) rejects, losing every module's model. Reachability: not yet wired into analyze; it becomes reachable when 'Switch Go import edges' lands. Java's packageDeclarationRoots walk has the same shape. Options: (1) catch EACCES/EPERM/ENOENT in walk and return the skipped directories as notices (attach to the first model or return them alongside) - cheap, recommended; (2) take the inventory's file list instead of walking, so the reader shares the analyzer's own directory handling - removes the walk but changes the signature."
acceptanceCriteria:
  - "readGoBuildModels(projectDir) on a tree containing an unlistable subdirectory resolves instead of rejecting"
  - "The skipped directory is reported as a notice"
  - "A unit test in tests/unit/language/go-build.test.ts covers the unreadable-directory case (skipped on Windows where chmod has no effect)"
touches:
  - "72b0abf4-b4be-4c2a-8336-dd84824ed71b"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "go"
source: "ndx-adversarial-review"
---
