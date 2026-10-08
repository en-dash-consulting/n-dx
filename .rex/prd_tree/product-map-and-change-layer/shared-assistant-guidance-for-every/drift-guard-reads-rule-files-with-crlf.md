---
id: "fcc686ff-b8cd-4b9f-be9a-f460421926c8"
level: "task"
title: "Drift guard reads rule files with CRLF line endings"
status: "completed"
priority: "high"
startedAt: "2026-10-07T03:30:36.978Z"
completedAt: "2026-10-07T03:44:27.658Z"
endedAt: "2026-10-07T03:44:27.658Z"
resolutionType: "code-change"
resolutionDetail: "rowsOf in tests/e2e/instruction-alignment.test.js now splits on /\\r?\\n/ and is hoisted to describe scope; a new test feeds it CRLF text. Verified by converting the three rule files to CRLF (73 pass) and by reverting the regex (the two Windows failures plus the new test reproduce)."
acceptanceCriteria:
  - "`rowsOf` splits on CRLF or LF: an optional `\\r` before each line feed (the regex in the task description)"
  - "A test feeds the drift guard CRLF rule text and passes"
  - "All 72 instruction-alignment tests pass with LF and with CRLF rule files"
description: "CLI Smoke (Windows) fails on #530 (run 37561295075): tests/e2e/instruction-alignment.test.js, 'core-injection-seams.md / web-injection-seams.md has the same table rows as its section in packages/<pkg>/AGENTS.md', reports every rule-file row missing from AGENTS.md.\n\nDiagnosis: rowsOf at tests/e2e/instruction-alignment.test.js:561 splits on a bare line feed (LF). Windows checks out .claude/rules/*.md with CRLF (core.autocrlf=true; .claude/rules/ has no eol pin), while only AGENTS.md is pinned to LF in .gitattributes. So every row parsed from a rule file keeps a trailing \\r and never equals the LF row from AGENTS.md. The neighbouring title lookups call .trim(), which strips the \\r, so only the row comparison fails. Reproduced on macOS by converting the two seam rule files to CRLF: the same 2 tests fail; with LF all 72 pass.\n\nFix: split on an optional carriage return followed by a line feed (a regex of the form slash, backslash-r, question mark, backslash-n, slash). Fix in the test, not in .gitattributes: leave .gitattributes alone; the drift guard must cope with either line ending. Keep the change to the test file."
lastModified: "2026-10-07T03:44:27.877Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
