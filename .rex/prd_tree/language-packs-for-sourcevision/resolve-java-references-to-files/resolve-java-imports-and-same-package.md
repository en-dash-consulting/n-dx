---
id: "e511c022-e759-4c42-bdb6-4951059e4ff8"
level: "task"
title: "Resolve Java imports and same-package references"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
blockedBy:
  - "24b251ed-e90b-42e9-af25-a3f5fb62628d"
source: "roadmap"
acceptanceCriteria:
  - "Single-type, wildcard, static and nested-type imports resolve to the declaring file"
  - "Same-package references with no import resolve through the per-package index"
  - "Name lookup follows Java's order: single-type import, then same package, then wildcard import"
  - "Unresolved references become external imports attributed by package prefix"
  - "Fixture goldens cover every case, including a name shadowed by a single-type import"
description: "Build a Java resolver for the pack. Index every top-level type by fully qualified name across all source roots, and keep a per-package index of simple names. Resolve:\n- import a.b.C to the file declaring a.b.C;\n- import a.b.* to each type in a.b that the file actually references;\n- import static a.b.C.m and a.b.C.* to the file declaring C;\n- nested types to the file of their top-level type;\n- bare type names first against single-type imports, then the same package, then wildcard imports, following Java's shadowing order.\njava.* and javax.* references, and any other reference to a package not found in the repository, become external imports attributed by package prefix (no version in this phase). Edges are file to file and deduplicated."
lastModified: "2026-10-07T23:56:23.406Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
