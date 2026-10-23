---
id: "7bb9838b-d5e8-49cd-bee0-e2c50ce6457b"
type: "change"
title: "java-sql treats the new type.anonymous capture as a type declaration because it selects every type.* capture"
slug: "java-sql-treats-the-new-type-anonymous"
intent: "Verdict: should-fix (low). Found by the adversarial review of a3c71293 (commit cc1cd123c).\n\nThat commit added `(object_creation_expression (class_body) @type.anonymous)` to queries/java/declarations.scm. packages/sourcevision/src/language/java-sql.ts:161 builds its type nodes as every declarations capture whose name starts with \"type.\" except \"type.name\", so anonymous class bodies now join that set. As a result, `innermost(typeNodes, annotation)` (line 166) attributes an annotation inside an anonymous body to the body instead of the named class around it.\n\nReachable: only through annotations that Java forbids there. @Entity and @Table target TYPE, and a type declared inside an anonymous body is its own, innermost type node. Valid Java's @Entity output is unchanged, and the embedded-sql and goldens tests pass. The coupling is still implicit: the next capture someone names `type.*` silently changes JPA entity detection.\n\nOptions:\n1. (Recommended) Rename the capture to `anonymous.body` (declarations.scm plus ANONYMOUS_BODIES in pack-facts.ts) so it leaves the type.* namespace. Cost: two lines. Risk: none; goldens have no anonymous class.\n2. Make java-sql list its declaration capture names explicitly (as java-resolver's DECLARATION_KINDS does). Cost: a small set. It also guards against future captures.\n\nAlso note for the operator: java-corpus-report's `declarations=` capture count now rises by the number of anonymous class bodies in each corpus. Parse rate and parity numbers are unaffected."
acceptanceCriteria:
  - "java-sql.ts does not count the anonymous-class-body capture among its type nodes (by an explicit capture-name list or because the capture is no longer prefixed type.)"
  - "A java-sql test with an anonymous class inside an @Entity class still reports that entity with its declared name and table"
  - "The Java language-pack goldens stay unedited"
touches:
  - "62f9bb19-c606-422d-b643-a4877b6dfcfd"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pack-contract"
source: "ndx-adversarial-review"
---
