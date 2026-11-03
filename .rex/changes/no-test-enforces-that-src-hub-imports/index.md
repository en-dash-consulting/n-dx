---
id: "5019cdd3-29c2-46b1-80a6-23eebd40b4c7"
type: "change"
title: "No test enforces that src/hub/ imports nothing from src/server/ or src/viewer/"
slug: "no-test-enforces-that-src-hub-imports"
intent: "Found by adversarial review of task ea48bb24. Verdict: out-of-scope (pre-existing), low.\n\npackages/web/src/hub/AGENTS.md (\"Import surface\") says the hub imports \"Nothing from src/server/ or src/viewer/\" and reaches project servers only over HTTP. Nothing checks that. tests/integration/boundary-check.test.ts covers the viewer barrels, shared/ consumers and server/viewer separation, but has no hub rule, and tests/e2e/architecture-policy.test.js has none either. Task ea48bb24 added a home.ts-only check in tests/unit/hub/home.test.ts, and it matches only single-line `import … from` statements.\n\nScenario: a change adds `import { appUrl } from \"../viewer/base-path.js\"` (or a multi-line import from ../server/…) to any src/hub/*.ts file. Typecheck and every test stay green. The hub daemon then pulls viewer or server modules into its process, against the documented boundary.\n\nReachable: any future edit to src/hub/. No current violation was found.\n\nOption (recommended): add a boundary-check.test.ts case that collects every src/hub/**/*.ts file and fails on any import or export specifier resolving under src/server/ or src/viewer/, or on a `preact` import. Reuse the file's extractImportPaths, which handles multi-line imports. Cheap, and no runtime risk."
acceptanceCriteria:
  - "boundary-check.test.ts fails when any src/hub/ file imports or re-exports from src/server/ or src/viewer/, including a multi-line import"
  - "boundary-check.test.ts fails when any src/hub/ file imports preact"
  - "The new case passes on the current tree"
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
