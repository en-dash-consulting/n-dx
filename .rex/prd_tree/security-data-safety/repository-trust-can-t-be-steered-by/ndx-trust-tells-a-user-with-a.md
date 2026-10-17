---
id: "1bc19544-aa09-4ebb-a4b6-97bd8bbd559d"
level: "task"
title: "`ndx trust .` tells a user with a repository test command there is \"nothing to trust\""
status: "in_progress"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
startedAt: "2026-10-17T16:52:46.928Z"
acceptanceCriteria:
  - "Closes #686 (finding 2, follow-up): `ndx trust .` reports a repository test command's acceptance state instead of \"nothing to trust\""
  - "On a baseline checkout with a test command and no matching trust record, `ndx trust .` does not say \"nothing to trust\"; it names the test command and the accept command"
  - "On the same checkout after `ndx trust accept .`, `ndx trust .` reports the test command as accepted"
  - "On a baseline checkout with no test command, the report is unchanged"
  - "A unit test of formatRepoTrustReport covers all three cases and fails on the current code for the first two"
description: "Verdict: should-fix (low). Found in the adversarial review of baedd10a, which fixed only the `accept` message.\n\nScenario: a checkout whose only deviation is a plain `.rex/config.json` `test` command (e.g. `node -e \"process.exit(0)\"`) evaluates `baseline`. verify_criteria and `rex verify` refuse to run it, and their note (TESTS_SKIPPED_UNTRUSTED in packages/rex/src/core/test-command-trust.ts) says \"Review with `ndx trust .`\". `ndx trust .` then prints \"Repository execution config: matches the defaults (nothing to trust).\" (formatRepoTrustReport, packages/llm-client/src/repo-trust.ts:791), so the review step tells the user there is nothing to accept. It also gives no accept hint in that state. The same text is shown after acceptance, since the state stays `baseline` even with a matching record.\n\nReachable: `ndx trust .` / `hench trust .` right after a verify_criteria or `rex verify` refusal. The dashboard trust strip reads the same evaluation.\n\nOptions:\n(1) In formatRepoTrustReport's baseline case, when `ev.config.testCommand` is set, say whether a matching record exists. Without one: \"test command not yet accepted; accept with <acceptCommand> so verify_criteria and rex verify can run it\". With one: \"test command accepted\". Cheap, and the evaluation shape is unchanged. Recommended.\n(2) Add a new state. This changes RepoTrustState, which web and JSON consumers read, so it costs too much.\n\n#686 finding 2, which this follows up:\n\n> **Fix:** treat any repository-owned test command as needing trust (an accepted digest) before `verify_criteria` runs it. Add a test with a plain, non-chained command.\n\nCaptured during the baedd10a run; kept in layer 1 by Ryan on 2026-10-16 (c09ff6b5 runs first)."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T16:52:47.195Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
