---
id: "cf48b266-8d20-406f-8cb2-b9eab671db1d"
level: "task"
title: "Frontmatter parser turns a literal backslash-n in a quoted string into a newline"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A string containing a literal backslash followed by n (e.g. C:\new) round-trips through emitYamlField and parseFrontmatter unchanged (test)"
  - "Strings containing \\r, a tab, a double quote, and a \\u0001 control character round-trip through the v2 prd-model-writer and prd-model-reader unchanged (test)"
  - "Existing folder-tree parser and serializer tests stay green"
description: "Verdict: out-of-scope. The defect predates the change that revealed it, the v2 tree writer (task b037993a). Both writers JSON-quote strings, so both are affected.\n\n**Failure.** `packages/rex/src/store/folder-tree-parser.ts` parseScalar (around line 1345) decodes a double-quoted value with sequential replaces in this order: `\\\"`, `\\\\`, `\n`, `\t`.\n- Example: the title `C:\new dir` is written as `\"C:\\\new dir\"` and read back with a real newline in place of `\n`.\n- Reproduced with the dist parser: `parseFrontmatter('---\ntitle: \"C:\\\\\\\new dir\"\n---\n')` returns `\"C:<newline>ew dir\"`.\n- JSON escapes the parser never decodes are also corrupted: `\\r` and `\\uXXXX` control characters come back as literal text.\n\n**Reachable.** Any title, description or other string field that contains a backslash. That covers v1 (emitYamlField) and v2 (prd-model-writer emitField). Every save after that compounds the change.\n\n**Options.**\n- (a) Recommended: decode double-quoted scalars with `JSON.parse(s)`, falling back to the current behaviour only when JSON.parse throws. This is cheap. The risk is that hand-written YAML escapes JSON lacks (`\\x`, `\\e`) would then take the fallback path.\n- (b) A single-pass regex decoder over the JSON escape set. It needs more code for the same result."
lastModified: "2026-10-07T18:31:16.803Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
