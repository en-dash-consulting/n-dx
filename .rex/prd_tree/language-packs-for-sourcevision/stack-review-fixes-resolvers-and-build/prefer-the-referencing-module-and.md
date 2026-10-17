---
id: "94e1f85d-5c45-45c2-bfc1-f607b2e10ffc"
level: "task"
title: "Prefer the referencing module and source set when a Java name has several declarations"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "lang-java"
  - "pr-18"
source: "review"
acceptanceCriteria:
  - "A reference resolves to the declaration in its own module and source set when one exists; main never resolves to test"
  - "Fan-out remains only for real ties; fixtures for cross-module and main/test duplicates"
  - "Edges only removed (no new edges) on the Java corpus"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks (thingsboard, petclinic) to the session and do not capture follow-ups for them."}
description: "Stack review (#763, java-resolver.ts:297). index.topLevel and index.types map an FQN to all files that declare it, and out.file(samePackage, name) adds an edge to each one. So do the longestType paths around lines 228–229 and 317. In a multi-module build:\n- svc-a/src/main/java/com/acme/config/App.java using SecurityConfig gets edges to both svc-a/…/SecurityConfig.java and svc-b/…/SecurityConfig.java;\n- src/main/java/com/acme/Foo.java using Helper links to both src/main/…/Helper.java and src/test/java/com/acme/Helper.java.\n\njavac would never link main code to test code, or one service to another's class. The false edges inflate coupling and can merge Louvain zones across services. discoverJavaModules (lang-kit java-modules.ts) exists but is not used by the resolver.\n\nFix: when a name has several candidates, prefer the one in the referencing file's own module (from discoverJavaModules, or the module root / path prefix) and the same source set.\n- Never resolve main → test. Test code may see main code, and test code in the same module may see test code.\n- Fan out only on a real tie: several candidates in the same module and source set, or none in the file's own module.\n\nAdd fixtures with duplicate FQNs across two modules, and across main/test. Expected change: fewer false edges on multi-module repos (thingsboard), with no new edges. The session checks the corpus."
lastModified: "2026-10-17T06:55:44.123Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
