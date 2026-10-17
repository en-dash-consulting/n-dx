---
id: "79ea58ea-288a-4a35-83d8-f79a785d3cab"
level: "task"
title: "Give Java externals the java: namespace"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "decision"
  - "lang-java"
  - "pr-18"
source: "review"
acceptanceCriteria:
  - "Every external the Java pack emits starts with java: (JDK packages under java:stdlib: if marked)"
  - "Goldens and corpus scripts updated; non-Java output and no-pack output unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Ryan decided this on 2026-10-16 (#763 comment); implement it as written, matching the python: task just before it. The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Ryan's decision (2026-10-16, #763 comment): Java externals take a language namespace too, matching Python. The Java pack and its imports.json output are unreleased, so this costs nothing now and would be a breaking rename later.\n\nEvery external the Java resolver emits (`out.externalPackage(...)` in packages/lang-java/src/java-resolver.ts) starts with `java:`, e.g. `java:org.springframework.web`. JDK packages (`java.*`, `javax.*`, `jdk.*`) go under `java:stdlib:` (`java:stdlib:java.util`) if the resolver can tell them apart cheaply. Otherwise use plain `java:` and say so in the log.\n\nRegenerate the lang-java goldens and update the tests and corpus scripts that assert bare names (java-corpus-report.mjs, the scip comparison script if it keys on externals). Expected change: imports.json externals for Java repos with the pack gain the prefix. Everything else stays identical, including non-Java repos and Java repos without the pack.\n\nLater, not in this task: the optional dependency field with Maven/Gradle coordinates from the build readers."
lastModified: "2026-10-17T06:55:43.227Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
