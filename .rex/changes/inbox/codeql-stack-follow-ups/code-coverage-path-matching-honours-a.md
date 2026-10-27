---
id: "13cd843d-77b1-4f29-8f77-006d200ee064"
type: "task"
title: "Code-coverage path matching honours a path separator boundary"
slug: "code-coverage-path-matching-honours-a"
description: "packages/rex/src/core/code-coverage.ts matching loop: changed.endsWith(itemPath) || itemPath.endsWith(changed) without a slash boundary, so lib/util.ts in a description matches a changed mylib/util.ts and every **/lib/util.ts. crossReferenceChanges is a public export with no caller in the monorepo. Surfaced by the layer 7 build and review of stack #855. Fix: require the shorter path to be the whole longer path or to follow a slash in it."
acceptanceCriteria:
  - "lib/util.ts does not match mylib/util.ts; src/lib/util.ts still matches lib/util.ts in both directions"
  - "The code-coverage test file covers both"
priority: "low"
source: "codeql-triage"
---
