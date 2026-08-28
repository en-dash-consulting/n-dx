---
id: "23409026-b3bc-4d24-9fc7-78806bd44527"
level: "task"
title: "The \"keeps the quiet acknowledgment\" test asserts nothing about the acknowledgment it names"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review-pass"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The test at review-watcher-suspension.test.ts:278 asserts on the captured stdout/console output, not only on the commit count"
  - "It asserts the output contains the quiet acknowledgment (\"proceeding to next task\") and does not contain the \"staged on top of it\" warning"
  - "Mutation check: deleting the else branch at shared.ts:1514-1516 makes this test fail (it currently passes)"
  - "Mutation check: deleting the whole didAutoCommit() block at shared.ts:1501-1518 makes this test fail (it currently passes)"
description: "Verdict: should-fix (severity medium — a test that does not protect the behaviour it names). Found by ndx-adversarial-review reviewing commit 0c23335f, which added this test.\n\nThe test \"keeps the quiet acknowledgment when the auto-commit left nothing staged\" at packages/hench/tests/unit/agent/review-watcher-suspension.test.ts:278-308 is vacuous.\n\nFailure scenario. The test body installs spies over process.stdout.write and console.log, collecting every line into a local `lines` array (test lines 279-288, restored in the finally at 302-305), calls performCommitPromptIfNeeded with a stub watcher whose didAutoCommit() returns true, and then never asserts on `lines` at all. Its only assertion is `expect(await git(projectDir, \"rev-list\", \"--count\", \"HEAD\")).toBe(\"1\")` (test line 307) — which already holds before the call, since the fixture makes exactly one commit in beforeEach (test lines 228-230) and this path commits nothing.\n\nConsequently the test passes under mutations that break the behaviour it is named for. Delete the entire else branch at shared.ts:1514-1516 (the detail(\"Auto-commit: timer-expiry auto-commit acknowledged...\") line) and it stays green. Delete the whole didAutoCommit() block at shared.ts:1501-1518 and it still stays green, because with no message file present performCommitPromptIfNeeded falls through to the `!existsSync(msgPath)` early return at shared.ts:1520 and likewise commits nothing. So the one branch this test exists to cover has, in practice, no coverage.\n\nRefutation attempted: read the full test body looking for a later assertion on the captured output. There is none. Its sibling test at review-watcher-suspension.test.ts:270-272 does exactly that — `expect(output).toContain(\"staged\")` and `expect(output).not.toContain(\"proceeding to next task\")` — which confirms the omission here is an oversight rather than a deliberate choice, and shows the spy scaffolding was copied without the assertions.\n\nReachability (Pass 2): the test runs on every `vitest run` of the hench package, so the false confidence is live. It is the only test touching the quiet-acknowledgment branch.\n\nWorth fixing: two lines, no risk.\n\nSolution (recommended): mirror the sibling test — assert that the captured output contains \"proceeding to next task\" and does NOT contain the \"staged on top of it\" warning. That makes the test fail if either the else branch is removed or the warning fires when it should not. Note that the same test file's coverage gap for the UNSTAGED leftover case is tracked separately on item 544d93d2-10f8-45a6-815b-5a7664d6a65c; fixing this item is only about making the existing assertion real, not about widening the scenario."
lastModified: "2026-08-28T16:30:07.707Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
