---
id: "c49072a8-15ef-40ad-8bf3-25105c34310b"
type: "change"
title: "boundary-check.test.ts's extractImportPaths misses namespace, default+named, `export * as` and dynamic imports"
slug: "boundary-check-test-ts-s"
intent: "Found by adversarial review of task 5019cdd3 (run ba8bac34). Verdict: out-of-scope (pre-existing), medium.\n\npackages/web/tests/integration/boundary-check.test.ts:68 `extractImportPaths` uses `(?:import|export)\\s+(?:type\\s+)?(?:\\{[^}]*\\}\\s+from\\s+|[\\w*]+\\s+from\\s+)?[\"']…[\"']`. Verified it returns nothing for `import * as v from \"../viewer/a.js\"`, `import a, { b } from \"../server/b.js\"`, `export * as n from \"../viewer/c.js\"` and `await import(\"../server/d.js\")`. Every boundary rule built on it is affected: server→viewer, viewer→external.ts gateway, shared/ consumers, crash/index.ts entry, hooks coupling, and more. `extractRuntimeImportPaths` (line 85) has the same gap.\n\nScenario: a change adds `import * as viewer from \"../viewer/index.js\"` to a src/server/ file. Every boundary test stays green, and the server pulls the viewer into its process.\n\nReachable: any future edit to web src. No current violation was checked.\n\nThe hub rule (task 5019cdd3) already uses the wider `extractModuleSpecifiers` added in that file.\n\nOptions:\n1. (Recommended) Point extractImportPaths at extractModuleSpecifiers. For extractRuntimeImportPaths, drop `import type` / `export type` statements. Fix any real violations or allowlist entries this surfaces. Cheap, but it may expose existing violations that need decisions.\n2. Use the TypeScript compiler API (ts.preProcessFile) for exact specifiers. More accurate, but slower and adds a dependency on the compiler in tests."
acceptanceCriteria:
  - "A boundary-check.test.ts self-test shows extractImportPaths returns the specifier for namespace, default+named, `export * as`, `export *` and dynamic `import()` forms"
  - "extractRuntimeImportPaths still excludes `import type` and `export type` specifiers and returns the forms above"
  - "Every existing boundary-check rule passes on the current tree, or each violation the wider extraction surfaces is fixed or allowlisted with a reason"
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "medium"
discoveredFrom: {"item":"5019cdd3-29c2-46b1-80a6-23eebd40b4c7","run":"ba8bac34-cfe6-4973-bbda-3b8dc1535895"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
