---
id: "6b6287bf-34ff-42ed-9036-61f89432cf43"
level: "task"
title: "Java resolver scans every qualified type span for each type name, quadratic on large generated files"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sourcevision"
  - "java"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "readReferences finds outermost qualified spans and filters type names in O((n+q) log q) or better, with no nested scan over all captures"
  - "A unit test feeds synthetic captures (e.g. 20k qualified spans and 60k names) through javaResolver.prepare/resolve, and its expected references show that names inside and outside the spans are classified the same as before"
  - "The Java pack golden and tests/integration/java-resolver.test.ts pass unchanged"
description: "Verdict: should-fix (found by the adversarial review of task e511c022).\n\nWhere: readReferences in packages/sourcevision/src/language/java-resolver.ts.\n- The outermost qualified spans are found with qualified.filter(q => !qualified.some(...)), which is O(q²).\n- Each @typeref.name is then checked with outermost.some(...), which is O(n·q).\n\nTrigger: a generated file near the 1 MB runner limit that writes fully qualified names everywhere, such as protobuf Java output (com.google.protobuf.Descriptors.Descriptor). Such a file can have about 20k scoped type captures and about 60k type identifiers. That is roughly 4e8 + 1.2e9 span comparisons for one file, so a single file stalls analyze for seconds.\n\nReachability: no code calls the resolver yet. It becomes a hot path once \"Feed Java edges into the analyze pipeline\" calls prepare/resolve for every Java file.\n\nFix options:\n(a) Recommended. Sort the qualified captures by start ascending and end descending, and keep one sweep pointer, so a capture is outermost when it starts after the current outer end. Then match names against the outermost spans with a second pointer, because both lists are in document order. The result is O((n+q) log q). It costs about 20 lines and its risk is ordering assumptions, which the existing goldens pin.\n(b) Change the query to capture only outermost scoped types. Tree-sitter queries cannot express \"not inside\", so this is not feasible."
lastModified: "2026-10-08T02:19:35.084Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
