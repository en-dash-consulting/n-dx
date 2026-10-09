---
id: "7c11cc6f-8644-41f2-aabc-2bc60dd1677f"
level: "task"
title: "tree-diff --format=markdown appends \"no PRD tree at this source.\" to the comment on stdout"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-18"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T08:07:02.242Z"
completedAt: "2026-10-09T08:13:49.655Z"
endedAt: "2026-10-09T08:13:49.655Z"
resolutionType: "code-change"
resolutionDetail: "Run 5909a3cd (claude-sonnet-5-5, review claude-opus-5-5), commit(s) e8afccb2b; stale dist only; gate re-run green after rebuild (node scripts/run-all-tests.mjs affected d9daaded2, 4/4 suites passed). Closed by the overnight Lane A session."
acceptanceCriteria:
  - "With --format=markdown and no --out, stdout holds only the Markdown comment when a side has no PRD tree; the notice goes to stderr"
  - "An integration test in packages/rex/tests/integration/tree-diff-sources.test.ts runs --format=markdown against a ref that predates the PRD and fails on the current stdout output"
description: "Scenario: a repository whose default branch has no PRD yet (the PR that adopts n-dx), CI runs `rex tree-diff --format=markdown > comment.md`. cmdTreeDiff (packages/rex/src/cli/commands/tree-diff.ts, markdown branch) calls reportWarnings after emit; reportWarnings reports `present: false` with `info()`, which is console.log (packages/llm-client/src/output.ts:72), so the posted comment ends with \"main: no PRD tree at this source.\" Parse warnings use warn() (stderr) and are fine; --json skips reportWarnings entirely.\n\nReachable: CI posting the comment from stdout, baseline without a tree. Already covered: no (tests write with --out). Out of scope for the review of 2279463d..HEAD: introduced in commit 2279463d, same feature.\n\nOptions: (a) in markdown mode route the notice through warn() (stderr) - one-line change, recommended; (b) skip reportWarnings in markdown mode like --json - loses the notice; (c) put the notice inside the comment as a line - changes comment content.\n\nChosen (overnight 2026-10-09, reversible): option (a). In markdown mode route the notice through warn() (stderr); text and JSON output unchanged."
lastModified: "2026-10-09T08:13:49.915Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
