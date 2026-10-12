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
description: "Verdict: out-of-scope (pre-existing), low. packages/sourcevision/src/language/java-modules.ts readText (end of file) catches only ENOENT. Scenario: a build-file-less project with a chmod 000 .java file → rootFromPackage → readText rethrows EACCES → discoverJavaModules rejects. Same for an unreadable pom.xml module in readMavenModules. Found reviewing 69ec8bf2, which fixed the unlistable-directory case only. Reachability: discoverJavaModules has no src caller today (only scripts/database-corpus-report.mjs and tests), so no analyze path is affected yet. Fix: treat EACCES/EPERM like the directory walk — skip the file and record a notice on JavaModuleLayout.notices; rethrow anything else. Cheap, low risk.\n\nImplementation brief (Java session, 2026-10-12):\n- readText in packages/sourcevision/src/language/java-modules.ts serves every file the discovery reads: module pom.xml files (readMavenModules), settings.gradle(.kts) and build.gradle(.kts) (readGradleModules), and .java files (rootFromPackage). Today it returns null only for ENOENT and rethrows the rest.\n- Treat EACCES and EPERM the way 69ec8bf2 treats an unlistable directory (commit d32b1245e): skip the file and record a notice in JavaModuleLayout.notices, using the same wording, `<project-relative posix path> is unreadable (<code>); skipped`. Rethrow any other code. Apply it to all three build systems (Maven, Gradle and no build file) so the layout reports notices the same way whichever path discovery took; notices stays omitted when empty, so existing toEqual assertions hold.\n- A skipped .java file contributes no source root; a skipped module pom.xml or Gradle build file is treated as absent.\n- Tests in tests/unit/language/java-modules.test.ts, skipped on Windows and as root like the 69ec8bf2 test, restoring the mode in finally: an unreadable .java file in a build-file-less project, and an unreadable module pom.xml in a Maven project.\nBefore (PR 10 at d6f6d3ae2, after pnpm build; run from the repository root):\n  D=$(mktemp -d) && mkdir -p $D/src/app && printf 'package app;\\nclass A {}\\n' > $D/src/app/A.java && printf 'package app;\\nclass B {}\\n' > $D/src/app/B.java && chmod 000 $D/src/app/B.java\n  node --input-type=module -e \"import('./packages/sourcevision/dist/language/java-modules.js').then(m=>m.discoverJavaModules(process.argv[1])).then(r=>console.log(JSON.stringify(r)),e=>console.log('rejects', e.code))\" $D\n  chmod 644 $D/src/app/B.java && rm -rf $D\n  -> rejects EACCES\nAfter (same commands, after pnpm build):\n  -> {\"buildSystem\":\"none\",\"modules\":[{...\"sourceRoots\":[\"src\"]}],\"notices\":[\"src/app/B.java is unreadable (EACCES); skipped\"]}\n  pnpm --filter @n-dx/sourcevision exec vitest run tests/unit/language/java-modules.test.ts  -> passes with the new cases"
lastModified: "2026-10-12T03:57:50.636Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
