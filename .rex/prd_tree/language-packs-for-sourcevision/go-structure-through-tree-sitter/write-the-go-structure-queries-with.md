---
id: "f817ad86-dc1b-481b-986e-77b48323d286"
level: "task"
title: "Write the Go structure queries with goldens"
status: "completed"
priority: "medium"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "pr-6"
blockedBy:
  - "8f4d555e-67a4-4ded-b67a-029211d5508b"
source: "roadmap"
startedAt: "2026-10-08T04:18:53.527Z"
completedAt: "2026-10-08T04:39:26.866Z"
endedAt: "2026-10-08T04:39:26.866Z"
resolutionType: "code-change"
resolutionDetail: "Code from hench run bd67e84c, committed by the operator session with the generated Go golden after the gate failed on the missing golden and a stale-dist packed-tarball check (c3d4a3ef). Verified 2026-10-08: 197 sourcevision tests (SV_REQUIRE_GRAMMARS=1) and the six root policy tests pass."
acceptanceCriteria:
  - "Query files exist for packages, imports, types, functions and methods, calls and struct tags"
  - "Goldens cover grouped, aliased, dot and blank imports, methods with pointer and value receivers, generics, and struct tags"
  - "Function and method captures carry start and end lines"
  - "Go import edges and incremental analysis are unchanged, with a test that would fail if the Go pack entered the imports phase"
  - "The six static root policy tests pass"
description: "Create go-pack.ts (using the existing goConfig, unchanged) with query files under src/language/queries/go/ for: package clause; imports in every form (single, grouped, aliased, dot, blank); type declarations (struct, interface, alias) with spans; functions and methods with receiver type and start/end lines; call expressions with receiver/selector and string-literal arguments; struct field tags (raw string). Add a fixture directory and commit goldens through the pack harness. Record provenance (grammar version, verified date).\n\nImportant: do not let the Go pack enter the imports phase yet. pack-imports.ts skips packs without a resolver for edges, but imports.ts (around line 690) still adds every pack file to changedFiles, which would force all .go files to re-parse on each incremental run. Keep the Go pack out of the import path (for example, only packs with a resolver count as import packs) and add a test that Go import edges and incremental behaviour are unchanged."
lastModified: "2026-10-08T04:39:28.034Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
