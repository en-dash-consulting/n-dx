---
id: "d429d9e3-136a-464b-809a-6a51d974f02a"
type: "change"
title: "Define title-to-filename normalization rules and implement pure helper"
slug: "define-title-to-filename-normalization"
intent: "Specify the exact slugification rules for converting an item title to a filename: lowercase, strip quotes and other punctuation, collapse whitespace to a single underscore, preserve unicode word characters, append `.md`. Implement and unit-test a single shared helper used by both the serializer and the migration command. Document rules in `docs/architecture/prd-folder-tree-schema.md` and CLAUDE.md."
acceptanceCriteria:
  - "Pure function exported from rex that maps any title string to a deterministic filename"
  - "Handles quotes, slashes, colons, parentheses, and other reserved filesystem characters by removing or replacing them"
  - "Spaces collapsed to single underscores; consecutive whitespace does not produce double underscores"
  - "Round-trip safe: applying the function twice yields the same result as applying it once"
  - "Unit tests cover ASCII, unicode, empty-after-normalization, and collision-prone cases (titles that differ only in punctuation)"
  - "Documented in `docs/architecture/prd-folder-tree-schema.md` with examples"
touches:
  - "1797eb3e-8ef9-4148-80fe-966693dd4e97"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "schema"
source: "smart-add"
---
