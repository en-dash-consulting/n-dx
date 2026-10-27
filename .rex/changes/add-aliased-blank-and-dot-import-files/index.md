---
id: "3a247c6a-8613-490d-888e-016ae0dd5ec2"
type: "change"
title: "Add aliased, blank, and dot import files to the Go fixture and update go.mod"
slug: "add-aliased-blank-and-dot-import-files"
intent: "Add new Go source files to packages/sourcevision/tests/fixtures/go-project/ to exercise import syntax variants not yet present: a file with aliased imports (e.g. chi \"github.com/go-chi/chi/v5\"), a file with blank/side-effect imports (e.g. _ \"github.com/lib/pq\"), and a dot import if it fits the fixture's domain. Add at least one _test.go file with a testing stdlib import to verify test file capture. Update go.mod require block to include any new third-party dependencies."
acceptanceCriteria:
  - "A Go source file with at least one aliased import is present in the fixture"
  - "A Go source file with at least one blank/side-effect import (_ \"pkg\") is present"
  - "At least one _test.go file with a testing or testing/assert import is present"
  - "go.mod require block includes all new third-party packages referenced by the added files"
  - "New files follow the existing fixture package and directory naming conventions"
  - "Files are syntactically valid Go (verified by the import parser not erroring during tests)"
amends: [{"target":"41a438d4-def7-4e85-ac41-e7b023184764","delta":"modified","summary":"Add aliased, blank, and dot import files to the Go fixture and update go.mod","base":"daef7fcb784420d85268ef620a403908fbcd22e80d2e505ddc0edd9d492983a0"}]
priority: "high"
tags:
  - "go"
  - "sourcevision"
  - "fixtures"
source: "smart-add"
---
