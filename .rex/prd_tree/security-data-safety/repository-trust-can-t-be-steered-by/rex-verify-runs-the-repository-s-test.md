---
id: "08f1520d-5bcd-4802-96f1-7b049a0ea735"
level: "task"
title: "`rex verify` runs the repository's test command by default with no trust check"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #686 (finding 2, CLI surface): `rex verify` applies the same rule as verify_criteria, so a repository-owned test command runs only once its digest is accepted"
  - "`rex verify .` on a checkout with a repository test command and no matching trust record does not run the command and says to run `ndx trust accept .`"
  - "After `ndx trust accept .`, the same `rex verify .` runs the command"
  - "A non-string `rex.test` is never executed"
  - "A rex e2e or unit test covers the refusal and the post-accept run"
description: "Verdict: out-of-scope (pre-existing), low. Found in the adversarial review of task 48f5ce09, which gated the MCP tool verify_criteria on an accepted trust digest.\n\nScenario: `packages/rex/src/cli/commands/verify.ts:21` sets `runTests = flags[\"dry-run\"] !== \"true\"`. A user who runs `rex verify .` (or `ndx rex verify .`) on a cloned checkout to see the criteria mapping therefore executes the repository's test command, from `.rex/config.json` or `.n-dx.json` `rex.test`, with no `ndx trust accept .`. The command also isn't type-checked, so a non-string `rex.test` from the `.n-dx.json` merge is stringified into the command line.\n\nReachability: an explicit human CLI action. That is weaker than the MCP path, where an agent can be prompt-steered into the call, which is why this is low. But the default is to run, and the command name doesn't suggest execution.\n\nOptions: (1) apply the same gate as verify_criteria (string command + accepted digest), refusing with the `ndx trust accept .` hint. Recommended: one rule for both surfaces. (2) Flip the default to mapping-only and require `--run-tests`. That is a CLI behaviour change needing a release note.\n\n#686 finding 2, which this follows up:\n\n> **Fix:** treat any repository-owned test command as needing trust (an accepted digest) before `verify_criteria` runs it. Add a test with a plain, non-chained command.\n\nCaptured during the T2 run (48f5ce09); kept in layer 1 by Ryan on 2026-10-16 and run after T3."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T22:45:40.170Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
