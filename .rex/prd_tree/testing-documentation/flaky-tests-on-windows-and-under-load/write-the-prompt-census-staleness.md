---
id: "7cb4850d-b3ae-45a5-b6d8-c2453fbb4c75"
level: "task"
title: "Write the prompt-census staleness probe outside the scanned tree"
status: "pending"
priority: "medium"
tags:
  - "flaky-test"
  - "ci-reliability"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #632"
  - "No test in tests/e2e/prompt-census.test.js writes a .mjs/.js file inside the repository; the staleness probe lives in an os tmpdir and is removed afterwards"
  - "The staleness test still proves --check exits 1 when a registered builder disappears"
  - "Any seam added to scripts/prompt-census.mjs is inert unless set, and the census's own default run and --check are unchanged"
  - "The completion note says whether the dirty-probe .tmp files at the repo root can trip any other suite or ndx ci step"
  - "prompt-census and architecture-policy pass when run together: npx vitest run tests/e2e/prompt-census.test.js tests/e2e/architecture-policy.test.js"
description: "GitHub #632. tests/e2e/prompt-census.test.js › \"--check exits non-zero when a registered builder disappears\" (around line 649) writes a modified copy of scripts/prompt-census.mjs to scripts/.prompt-census-staleness-probe.mjs, runs it, then deletes it. The root suite runs test files in parallel, so tests/e2e/architecture-policy.test.js (and ndx ci's checkArchitecturePolicy) can scan scripts/ while the copy exists, find its child_process import, and fail on a file nobody committed.\n\nFix the race so it cannot recur. Preferred (the issue's option 1): write the probe to an os tmpdir, outside the repository, and point it at the repo. The census computes ROOT from its own location (scripts/prompt-census.mjs, ROOT = dirname/..) and resolves modules with createRequire from ROOT, so a copy outside the tree needs a way to be told the repo root; add the smallest such seam to scripts/prompt-census.mjs (for example an env var or option read only when set), and check the copy's own imports still resolve. Rejected unless option 1 proves unworkable: excluding the probe's name from the architecture-policy scan (option 2), because it hides this probe but leaves the general hazard, and running the file serially (option 3), which only narrows the window. If you fall back to option 2, say why in the completion note and exclude it in both the test and checkArchitecturePolicy.\n\nThe same file writes .prompt-census-dirty-probe.tmp and .prompt-census-dirty-probe2.tmp at the repo root (around lines 475 and 509). Check whether any suite or ndx ci step scans files of that shape; record the answer, and move them out only if something does and the test's purpose survives the move.\n\nThe staleness guard must stay load-bearing: the broken copy must still make --check exit 1.\n\nScope: tests/e2e/prompt-census.test.js and scripts/prompt-census.mjs only. Product code otherwise untouched."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:28:51.668Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
