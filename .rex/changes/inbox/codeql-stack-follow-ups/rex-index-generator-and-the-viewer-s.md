---
id: "0ed0b88e-cf20-432a-bc55-5d22c5c3a1bd"
type: "task"
title: "Rex index generator and the viewer's commits table agree, and the stale duplicate test goes"
slug: "rex-index-generator-and-the-viewer-s"
description: "packages/rex/src/store/tests/folder-tree-index-generator.test.ts sits under src/ outside rex's vitest include and never runs (it asserts an older format); delete it. In folder-tree-index-generator.ts the commit author cell is unescaped (a pipe in a git author name splits the row) and fullHash is assigned and never used. packages/web/src/viewer/utils/index-md-parser.ts parseCommitsList splits rows on a bare pipe and never unescapes the pipe or backslash the generator writes. The frontmatter fallback decoder keeps \\uXXXX, \\b, \\f and \\/ literal when a non-JSON escape is present in the same scalar. All dormant: nothing assigns item.commits today. Surfaced by the layer 3 build and review of stack #855."
acceptanceCriteria:
  - "The src/store/tests duplicate is deleted and the live suite under tests/unit/store covers the generator"
  - "Author and message cells escape pipe and backslash, and the viewer parser unescapes both, with a round-trip test"
  - "The fallback decoder handles \\uXXXX, \\b, \\f and \\/ like JSON"
priority: "low"
source: "codeql-triage"
---
