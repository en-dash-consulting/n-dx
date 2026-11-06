---
id: "aab04326-e030-4ea2-a4ed-c7ce3f1dc34d"
type: "change"
title: "hench run --mine --epic-by-epic reports a missing PRD folder instead of the flag conflict"
slug: "hench-run-mine-epic-by-epic-reports-a"
intent: "Failure: in a project initialised by `hench init <dir>` (the e2e fixture), `hench run --mine --epic-by-epic <dir>` now exits 1 with \"No PRD folder at .rex.\" instead of \"Cannot use --mine with --epic-by-epic\". `packages/hench/tests/e2e/run-flag-conflicts.test.ts:63` fails against a fresh build of this branch.\n\nCause: the missing-PRD-folder check from commit a548ca10b (packages/hench/src/cli/commands/prd-folder.ts, called from run.ts) runs before the flag-conflict refusal at run.ts:~1999. Either `hench init` alone creates no PRD folder, or that ordering is new. It passed against a dist built before a548ca10b.\n\nReachable: yes, through the CLI. It also blocks the branch PR, because CI runs hench e2e.\n\nFound by the adversarial review of run c55a2422 (task 8b4233b1). It is outside that task's diff, which does not touch either check. Verdict: out-of-scope. It comes from sibling commit a548ca10b on the same branch, so fix it before that branch's PR.\n\nOptions:\n(a) Validate flag conflicts before the PRD-folder check. This is cheap; argument errors should come before environment errors. Recommended.\n(b) Change the test fixture to create a PRD. This hides the ordering question."
acceptanceCriteria:
  - "`hench run --mine --epic-by-epic <dir>` on a `hench init`-only project exits 1 with \"Cannot use --mine with --epic-by-epic\""
  - "tests/e2e/run-flag-conflicts.test.ts passes against a fresh hench build"
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "medium"
discoveredFrom: {"item":"8b4233b1-cb6a-4b38-a21b-7d0143d48bd4","run":"c55a2422-4c93-4de9-919d-15092fc230f9"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
