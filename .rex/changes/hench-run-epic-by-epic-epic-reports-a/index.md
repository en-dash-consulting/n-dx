---
id: "0c2bed4d-a54e-4572-a5c7-d20129315535"
type: "change"
title: "hench run --epic-by-epic --epic reports a missing PRD folder instead of the flag conflict"
slug: "hench-run-epic-by-epic-epic-reports-a"
intent: "Failure: on a project with no PRD folder (for example after `hench init` alone), `hench run --epic-by-epic --epic=x <dir>` exits 1 with \"No PRD folder at .rex.\" instead of \"Cannot use --epic-by-epic with --epic.\" (packages/hench/src/cli/commands/run.ts:~2236). The same applies to the other argument-only refusals that run after `assertPrdFolderExists` (run.ts:~1916): the review-flag refusals from parseReviewOptions.\n\nCause: commit a548ca10b put the PRD-folder check near the top of cmdRun. Change aab04326 moved only the --mine/--epic-by-epic refusal ahead of it.\n\nReachable: yes, through the CLI. Both errors are real, so the operator fixes one and then meets the other. Low severity. No test covers the --epic-by-epic with --epic refusal at all (grep packages/hench/tests).\n\nVerdict: out-of-scope for aab04326, found by its adversarial review.\n\nOptions: (a) Gather the pure flag-combination refusals into one validateRunFlags(flags) called first in cmdRun. Cheap, and argument errors come before environment errors. Recommended. (b) Leave the order alone and document it. Free, but the error a user sees stays inconsistent."
acceptanceCriteria:
  - "`hench run --epic-by-epic --epic=x <dir>` on a `hench init`-only project exits 1 with \"Cannot use --epic-by-epic with --epic\""
  - "A test in packages/hench/tests/e2e/run-flag-conflicts.test.ts covers that refusal against a project with no PRD folder"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "low"
discoveredFrom: {"item":"aab04326-e030-4ea2-a4ed-c7ce3f1dc34d","run":"2aecb417-8918-4d20-9b01-5ad7ee8f44f3"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
