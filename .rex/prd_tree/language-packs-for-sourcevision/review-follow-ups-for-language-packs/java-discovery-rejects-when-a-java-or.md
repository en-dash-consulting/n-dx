---
id: "fea83049-9515-4dd3-bfa4-a6d131d3c4a2"
level: "task"
title: "Java discovery rejects when a .java or pom.xml file is unreadable"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "java"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "discoverJavaModules on a build-file-less project containing an unreadable .java file resolves and lists the readable roots"
  - "The unreadable file is reported in layout.notices"
  - "A unit test covers the unreadable-file case (skipped on Windows and as root)"
description: "Verdict: out-of-scope (pre-existing), low. packages/sourcevision/src/language/java-modules.ts readText (end of file) catches only ENOENT. Scenario: a build-file-less project with a chmod 000 .java file → rootFromPackage → readText rethrows EACCES → discoverJavaModules rejects. Same for an unreadable pom.xml module in readMavenModules. Found reviewing 69ec8bf2, which fixed the unlistable-directory case only. Reachability: discoverJavaModules has no src caller today (only scripts/database-corpus-report.mjs and tests), so no analyze path is affected yet. Fix: treat EACCES/EPERM like the directory walk — skip the file and record a notice on JavaModuleLayout.notices; rethrow anything else. Cheap, low risk."
lastModified: "2026-10-12T02:03:50.193Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
