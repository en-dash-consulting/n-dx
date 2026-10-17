---
id: "d59a9daa-1f83-40c8-9c9e-3210a2507774"
level: "task"
title: "Skip Java build output only at module roots, not every directory named target, build, out or generated"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "lang-kit"
  - "lang-java"
  - "pr-17"
source: "review"
acceptanceCriteria:
  - "A Java package directory named target, build, out or generated below src/ is inventoried"
  - "Module-root build output (next to pom.xml/build.gradle*) is still skipped, for javaConfig and javaSecondaryConfig"
  - "The rule uses the existing conditional-skip mechanism; fixtures for both cases pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network and ~/.cache corpora. If it does, leave the corpus and byte-identity checks to the session, which verifies them; do not capture follow-ups for them."}
description: "Stack review (#762). javaConfig.skipDirectories in packages/lang-kit/src/java.ts (around line 55) lists target, build, out and generated, and the walker drops any directory with one of those names at any depth. Spring Framework, for example, is detected as Java (a Gradle root, no root package.json). Every file in spring-aop/src/main/java/org/springframework/aop/target/ then vanishes from inventory.json, and imports of org.springframework.aop.target.* cannot resolve. The same happens to any package named out, build or generated, and to non-Java files under such directories. javaSecondaryConfig also skips target at any depth, so a TS-primary repo with a nested pom.xml loses its target/ directories too.\n\nFix: skip those names only where they are build output. A directory is build output when it is directly under a module root, meaning a directory holding pom.xml, build.gradle or build.gradle.kts, or under the project root. A directory below src/ is never build output. Reuse the conditional skip mechanism from PR 15b: lang-kit's LanguageConfig.skipUnlessContains and skipsDirectory, applied in sourcevision's project walker. Extend it with a new rule kind if a parent-holds-marker test is needed, rather than adding a parallel mechanism. Cover javaConfig and javaSecondaryConfig.\n\nTests: fixtures with:\n- src/main/java/com/acme/target/X.java, which must be inventoried;\n- a module-root target/classes/..., which stays skipped;\n- a nested module (sub/pom.xml with sub/target/), which stays skipped.\n\nThen a TS-primary repo with a nested pom.xml whose source tree has a target package. Non-Java repos must stay byte-identical; the session verifies on the corpus."
lastModified: "2026-10-17T02:03:35.308Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
