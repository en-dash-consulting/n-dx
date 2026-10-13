---
id: "a1edcfcb-5d09-4e10-be2f-f815fa9da561"
level: "task"
title: "Layer 5 · Fold spawn-per-test e2e files into run-once, assert-many"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "Test count per file does not drop"
  - "cli-ci.test.js falls from 255s to under 40s on the Windows leg"
description: "One commit per file: tests/e2e/cli-ci.test.js, cli-init.test.js, cli-config.test.js; rex cli-prd-bundle, cli-prune, cli-smart-add, cli-folder-tree; hench run-resolve. Group tests by fixture state and argv, run the CLI once in beforeAll, keep one it per assertion. Mutating tests copy a template dir built once rather than calling setupProject per test."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-13T19:53:01.683Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
