---
id: "8ce5cd15-30aa-4d3a-8454-78ab70d3a936"
type: "change"
title: "Resolve pack file paths without the global URL so jsdom tests can load sourcevision"
slug: "resolve-pack-file-paths-without-the"
intent: "Found when hench run 9444b5a0 (task cc902750, Feed Java edges into the analyze pipeline) failed its test gate: web's tests/integration/pr-markdown-refresh.test.ts, which runs under @vitest-environment jsdom, fails at import with 'TypeError: The URL must be of scheme file' at queryPath in packages/sourcevision/src/language/java-pack.ts:19, reached from pack.ts:22. Since that task wired language packs into analyzeImports, web's sourcevision gateway loads pack.ts and java-pack.ts, and both compute file paths at module load with fileURLToPath(new URL(relative, import.meta.url)). Under jsdom the global URL is not Node's, so fileURLToPath rejects it. pack.ts:176 (DEFAULT_GRAMMAR_DIR) has the same pattern.\n\nFix both without the global URL constructor: derive the module's directory once with dirname(fileURLToPath(import.meta.url)) and build paths with node:path join or resolve. Keep the paths identical from src/ and dist/. Prefer computing them lazily, on first use, over at import, so importing sourcevision never touches the filesystem layout. Search sourcevision for any other new URL(..., import.meta.url) passed to fileURLToPath at module load and fix those the same way. Do not change web's tests or vitest environment; the library must load under jsdom.\n\nThe code from run 9444b5a0 (commits a01418929 and 54dcd503b) is already committed on this branch; do not redo it. After this task, the operator verifies and completes cc902750 separately."
acceptanceCriteria:
  - "web's tests/integration/pr-markdown-refresh.test.ts passes, and the full @n-dx/web suite passes"
  - "No sourcevision module computes a path with fileURLToPath(new URL(...)) at import time"
  - "A sourcevision regression test running under @vitest-environment jsdom imports the pack loader and the Java pack and resolves the grammar and query paths"
  - "Grammar and query paths resolve to the same files from src/ and dist/, and the language-pack tests and goldens still pass"
  - "The six static root policy tests pass"
touches:
  - "f522e7ae-44aa-458b-80ef-7a1132416c0c"
priority: "high"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "web"
source: "run-failure"
---
