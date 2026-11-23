---
id: "b38671c4-3f94-4a2c-9014-d51c5af76e00"
type: "change"
title: "Go oversized-file test expects the new per-pack parse-issues line"
slug: "go-oversized-file-test-expects-the-new"
summary: "A check that the analyzer still reads very large Go files started failing after the PHP work added a one-line report of files it could not fully read. The analyzer behaves correctly; the check needs to expect that line."
intent: "Found by full CI (ci:run) on #1089 at e60606e9b, 2026-11-19, on Linux, macOS and Windows, and reproduced locally at PR 12 (restack/pr12, 96dd82462) with every grammar built: 1 failed of 3,547 sourcevision tests. Locally the test had been skipped because no Go grammar was built in the worktrees, so targeted runs never reached it.\n\nTest: packages/sourcevision/tests/integration/imports-go-incremental.test.ts, 'keeps the imports of a Go file over the pack's size limit from its import prefix, naming the skipped structure'. It expects messages to equal one line (the oversized-file notice). Commit 612011bd3 (PR 12, task 7ffab98a, 'report files that do not parse cleanly, per pack') added parseIssuesNotice in packages/sourcevision/src/analyzers/pack-imports.ts, so the run now also warns '[go-parse] 5 files: 1 over 1 MiB not parsed; listed in imports.json summary.parseIssues.'. That line is intended behaviour for every pack.\n\nPrivacy rule: no client name, repository name, path or finding text in this repository."
acceptanceCriteria:
  - "tests/integration/imports-go-incremental.test.ts passes with the Go grammar built"
  - "The full sourcevision suite passes with SV_REQUIRE_GRAMMARS=1"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"01376afa-1f03-4da1-b42e-2baef55d2c9b"}
tags:
  - "sourcevision"
  - "ci"
  - "php-pr12"
---
