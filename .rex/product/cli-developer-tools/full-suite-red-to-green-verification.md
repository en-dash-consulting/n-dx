---
id: "982f45e5-cb5f-41be-84a3-3736378247c9"
type: "capability"
title: "Full-Suite Red-to-Green Verification"
slug: "full-suite-red-to-green-verification"
statement: "The full test suite passes, and failures are fixed in the code rather than masked by editing the tests."
criteria: [{"id":"c1","text":"The system shall ensure that running `vitest run` completes successfully with all tests passing."},{"id":"c2","text":"The system shall ensure that running `pnpm -r run test` completes successfully with all package tests passing."},{"id":"c3","text":"The system shall ensure that the total number of executed tests matches the pre-refactor baseline."}]
source: "smart-add"
---

Restore full test pass status across the project while preserving the integrity of the test refactor and avoiding test edits that merely mask real failures.

## History

- 2026-10-23 editorial: statement edited
