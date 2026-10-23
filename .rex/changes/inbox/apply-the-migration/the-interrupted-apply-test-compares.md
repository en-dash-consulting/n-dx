---
id: "16ad2d6d-0a50-4e57-8909-fb4710a65acd"
type: "task"
title: "The interrupted-apply test compares normalised snapshot paths, so Windows CLI smoke passes"
slug: "the-interrupted-apply-test-compares"
description: "Review of #689 (2026-10-12), should-fix, CONFIRMED (CI log read). packages/rex/tests/unit/migrations/v1-to-v2/apply.test.ts:331 restores the v1 files by filtering snapshot keys with path.startsWith(\"/prd_tree\") (and === \"/tree-meta.json\"). snapshot() (lines 78-89) builds keys with p.slice(dir.length), which gives \\prd_tree\\… on Windows, so nothing is restored and apply correctly reports removed: [].\n\nFailure scenario: run 38234881208, 'CLI Smoke (Windows)', rex suite: 'finishes an apply interrupted after the switch by removing the v1 files left beside the v2 tree' fails with expected { status: 'already-v2', removed: [] } to deeply equal {…removed: [prd_tree, tree-meta.json]}. It is the only failure (6596 passed), and #691 inherits it (run 38275168692). Not a product defect.\n\nFix: normalise the keys (relative(dir, p).split(sep).join(\"/\"), as prd-model-inbox.test.ts:58 does). The PR body notes that this turns Windows smoke green."
acceptanceCriteria:
  - "snapshot() keys in apply.test.ts use forward slashes on every platform (relative + split(sep).join('/'))"
  - "The interrupted-apply test restores prd_tree/ and tree-meta.json when path.sep is '\\' (test that simulates the Windows separator, or a key-normalisation unit test; fails at 4646976bad)"
  - "apply.test.ts passes on macOS/Linux unchanged"
priority: "medium"
tags:
  - "pr-23"
  - "lane-migration"
  - "review-2026-10-12"
  - "v2-migrate-l7"
source: "review-2026-10-12"
blockedBy:
  - "1aba5faa-aa60-4566-a045-928ab6c61795"
---
