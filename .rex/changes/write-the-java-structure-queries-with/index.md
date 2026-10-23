---
id: "12afe7fd-ec91-424d-9dc1-d932848044e4"
type: "change"
title: "Write the Java structure queries with goldens"
slug: "write-the-java-structure-queries-with"
intent: "Create the Java pack with query files for: package declaration; single-type, wildcard and static imports; top-level and nested type declarations (class, interface, enum, record, annotation type) with their spans; method and constructor declarations with start and end lines (later used for near-duplicate detection); method invocations with receiver expression and string-literal arguments; and type references in fields, parameters, return types, extends, implements, annotations and object creation.\n\nAdd a fixture directory of small Java sources covering each case, plus generics, inner classes, lambdas and text blocks, and commit goldens through the harness. Record provenance for the pack: the grammar version and the date it was verified."
acceptanceCriteria:
  - "Query files exist for packages, imports, declarations, methods, calls and type references"
  - "Goldens cover single, wildcard and static imports, nested types, records, enums, annotation types, generics, lambdas and text blocks"
  - "Method captures carry start and end lines"
  - "Call captures carry the receiver expression and any string-literal arguments"
  - "The pack's provenance names the grammar version and verification date"
touches:
  - "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "java"
source: "roadmap"
blockedBy:
  - "4554831e-6e96-470f-8f6c-1248ad9637d9"
---
