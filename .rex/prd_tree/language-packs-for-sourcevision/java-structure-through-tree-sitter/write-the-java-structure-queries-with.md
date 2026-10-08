---
id: "12afe7fd-ec91-424d-9dc1-d932848044e4"
level: "task"
title: "Write the Java structure queries with goldens"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "java"
blockedBy:
  - "4554831e-6e96-470f-8f6c-1248ad9637d9"
source: "roadmap"
acceptanceCriteria:
  - "Query files exist for packages, imports, declarations, methods, calls and type references"
  - "Goldens cover single, wildcard and static imports, nested types, records, enums, annotation types, generics, lambdas and text blocks"
  - "Method captures carry start and end lines"
  - "Call captures carry the receiver expression and any string-literal arguments"
  - "The pack's provenance names the grammar version and verification date"
description: "Create the Java pack with query files for: package declaration; single-type, wildcard and static imports; top-level and nested type declarations (class, interface, enum, record, annotation type) with their spans; method and constructor declarations with start and end lines (later used for near-duplicate detection); method invocations with receiver expression and string-literal arguments; and type references in fields, parameters, return types, extends, implements, annotations and object creation.\n\nAdd a fixture directory of small Java sources covering each case, plus generics, inner classes, lambdas and text blocks, and commit goldens through the harness. Record provenance for the pack: the grammar version and the date it was verified."
lastModified: "2026-10-07T23:55:38.903Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
