---
id: "ec5c370b-3010-49d3-aed5-5606217fa7fb"
type: "task"
title: "The boundary-check extractors return every import form"
slug: "the-boundary-check-extractors-return"
description: "Option 1 of change c49072a8: point extractImportPaths at extractModuleSpecifiers, and have extractRuntimeImportPaths drop import type / export type statements. Runs before the drawer-bundle task, which edits the same test file."
acceptanceCriteria:
  - "A boundary-check.test.ts self-test shows extractImportPaths returns the specifier for namespace, default+named, `export * as`, `export *` and dynamic `import()` forms"
  - "extractRuntimeImportPaths still excludes `import type` and `export type` specifiers and returns the forms above"
  - "Every existing boundary-check rule passes on the current tree; each violation the wider extraction surfaces is fixed or allowlisted with a reason in the test"
priority: "medium"
source: "adversarial-review"
---
