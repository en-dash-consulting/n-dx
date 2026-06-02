---
id: "094e978e-c6e9-4299-a85d-215bd3c1d851"
level: "task"
title: "Add regression tests asserting all four required sections appear in generated README output"
status: "pending"
priority: "high"
tags:
  - "init"
  - "readme"
  - "testing"
source: "smart-add"
acceptanceCriteria:
  - "Test asserts ## Overview, ## Quick Start, ## Testing, and ## License headings are present in generated README.md"
  - "All four assertions are mirrored for the README.proposed.md output path"
  - "Test covers the fallback case where package.json has no license field and verifies a non-empty stub is written"
  - "Test covers the fallback case where no test command is detected and verifies a non-empty stub is written"
  - "All new tests pass in CI without modification to existing test infrastructure"
description: "Extend the existing README generation test suite to assert that Overview, Quick Start, Testing, and License sections are present in both output paths. Tests should cover the happy path (package.json supplies description, test command, and license) and the fallback path (fields absent, stubs are emitted instead)."
overrideMarker: {"type":"duplicate_guard_override","reason":"content_overlap","reasonRef":"content_overlap:0bf2217f-85cb-4154-911b-71028142cbc9","matchedItemId":"0bf2217f-85cb-4154-911b-71028142cbc9","matchedItemTitle":"Add regression tests for target-repo README generation and proposed-file fallback","matchedItemLevel":"task","matchedItemStatus":"completed","createdAt":"2026-06-02T14:29:23.403Z"}
---
