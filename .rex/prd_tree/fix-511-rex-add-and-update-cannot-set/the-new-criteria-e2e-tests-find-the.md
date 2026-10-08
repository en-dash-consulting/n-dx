---
id: "d1d9f3d3-76fa-4fe4-b9a6-e39f6addd443"
level: "task"
title: "The new criteria e2e tests find the item file on Windows"
status: "pending"
priority: "high"
tags:
  - "fix"
  - "rex"
  - "tests"
  - "windows"
source: "ndx-capture"
acceptanceCriteria:
  - "Both item-file lookups in tests/e2e/cli-add.test.js and tests/e2e/cli-update-criteria.test.js match an entry written with `\\` separators (e.g. `test-epic\\criteria-item.md`) as well as `/`."
  - "The content assertions normalise CRLF to LF before matching."
  - "A check that runs on macOS/Linux exercises the backslash path form, so the Windows case is covered off Windows."
  - "Both test files pass locally against the built CLI; no file under packages/rex/src changes."
  - "The CLI Smoke (Windows) job on PR #604 passes after the push."
description: "PR #604's \"CLI Smoke (Windows)\" job fails in \"Run root e2e / integration tests\" (run 37837173924, job 113517737170). The failures are the two tests this epic added. The CLI itself works on Windows: the log lists the written file.\n\n```\nFAIL tests/e2e/cli-add.test.js > ndx add CLI delegation > writes repeated --criterion (both argv forms) and --source to the item's index.md\nAssertionError: no file for the item among: test-epic, test-epic\\another-task.md, test-epic\\criteria-item.md, test-epic\\index.md, test-epic\\test-task.md\n\nFAIL tests/e2e/cli-update-criteria.test.js > ndx update --criterion / --source > replaces then clears acceptance criteria, reading the item back each time\nAssertionError: no file for another-task among: test-epic, test-epic\\another-task.md, test-epic\\index.md, test-epic\\test-task.md\n```\n\nCause: `readdir(treeDir, { recursive: true })` returns paths joined with the platform separator, which is `\\` on Windows. Both lookups match with a `/`-only pattern:\n- `tests/e2e/cli-add.test.js`, about line 67: `/(^|\\/)criteria-item(\\.md|\\/index\\.md)$/`\n- `tests/e2e/cli-update-criteria.test.js`, `readItem`, about line 22: `new RegExp(\\`(^|/)${slug}(\\\\.md|/index\\\\.md)$\\`)`\n\nFix (tests only, no product code):\n1. Normalise each readdir entry to `/` before matching (e.g. `p.split(sep).join(\"/\")` with `sep` from `node:path`, or `p.replaceAll(\"\\\\\", \"/\")`), and keep `join(treeDir, e)` on the original entry for the read. Matching `[\\\\/]` in the patterns is also acceptable. Pick one approach and use it in both files; consider moving the lookup into one small local helper in each file rather than adding a new export to `tests/e2e/e2e-helpers.js`.\n2. As a precaution for the content assertions that follow, normalise `\\r\\n` to `\\n` on the text read back before the `^acceptanceCriteria:\\n…` and `^source:` regexes run, so a CRLF file cannot fail them on Windows.\n3. Do not change `packages/rex/src` — the Windows log shows the CLI wrote the right file.\n\nVerify locally: `node_modules/.bin/vitest run tests/e2e/cli-add.test.js tests/e2e/cli-update-criteria.test.js` (build rex first: `pnpm --filter @n-dx/rex build`). You cannot run Windows here, so add a unit-level check of the normalisation if it is cheap — e.g. feed a `test-epic\\\\criteria-item.md` string through the same match function — so the Windows path form is exercised on macOS/Linux too. Run the root policy tests listed in the epic before finishing. No changeset (test-only change; the epic's @n-dx/rex changeset already covers the PR)."
lastModified: "2026-10-08T20:18:31.390Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
