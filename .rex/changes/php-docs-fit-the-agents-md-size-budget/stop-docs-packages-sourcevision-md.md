---
id: "0db76c66-591b-4e9b-a305-46838b81aadd"
type: "task"
title: "Stop docs/packages/sourcevision.md naming the edit_area folder as a code span"
slug: "stop-docs-packages-sourcevision-md"
summary: "Rewords one docs line so the documentation check no longer mistakes a library folder name for a tool name."
description: "In `docs/packages/sourcevision.md`, the third-party fingerprint bullet (about line 332) lists folders named after well-known libraries as code spans: `edit_area`, `tinymce`, `PHPExcel`. `mcpToolRefs` in `tests/e2e/docs-command-refs.test.js` reads a snake_case code span whose first word is an MCP tool verb (`edit`) as a tool name and fails on `edit_area`. Reword so the folder names are not code spans (for example by library name: EditArea, TinyMCE, PHPExcel, with the folder names in plain text), keeping the meaning. Check the rest of the PHP-stack docs for any other snake_case code span starting with a tool verb (get, edit, add, update, move, merge, claim, release, append, place, apply, search, set, verify) and reword those the same way. Do not change the test or `packages/sourcevision/src/analyzers/third-party.ts`. Verify: `npx vitest run tests/e2e/docs-command-refs.test.js` from the repository root."
acceptanceCriteria:
  - "docs/packages/sourcevision.md no longer writes edit_area (or any other verb_noun folder name) as a code span, and the bullet keeps its meaning"
  - "tests/e2e/docs-command-refs.test.js passes without changing the test"
priority: "high"
run: {"tier":"light","review":false,"skipTestGate":true}
---
