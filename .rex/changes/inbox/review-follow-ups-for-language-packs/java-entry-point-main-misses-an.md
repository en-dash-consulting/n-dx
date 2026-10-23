---
id: "0fea34d3-2547-4f98-b8b5-231d1770d6ca"
type: "task"
title: "Java entry_point.main misses an interface's implicitly public static void main"
slug: "java-entry-point-main-misses-an"
description: "Verdict: should-fix (severity low). Found reviewing 144cf782 (commit 89431bdf0).\n\nScenario: `interface Tool { static void main(String[] args) {} }` is a launchable entry point (interface members are implicitly public; `java Tool` runs it since Java 8), but packages/sourcevision/src/language/queries/java/methods.scm requires a `modifiers` node containing both \"public\" and \"static\", so the method gets no entry_point.main capture. Verified against tree-sitter-java 0.23.5 with the committed query.\n\nReachability: no analyzer reads entry_point.main yet, so there is no wrong output today; it becomes a false negative once a consumer reads it.\n\nOptions: (1, recommended) add a second pattern for a method_declaration inside interface_declaration > interface_body whose modifiers include \"static\" (public optional), reusing the same parameter/predicate shape; cost one pattern and a test case, no risk to class methods. (2) Capture static-only mains anywhere and filter by enclosing declaration in code; more moving parts."
acceptanceCriteria:
  - "An interface method `static void main(String[] args)` without `public` gets an entry_point.main capture"
  - "A class method `static void main(String[] args)` without `public` still gets no capture"
  - "tests/integration/java-pack-queries.test.ts covers both cases"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "java"
  - "language-packs"
source: "ndx-adversarial-review"
---
