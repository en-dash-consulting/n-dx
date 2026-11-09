---
id: "baedd10a-755f-4a23-98c7-71beab5a46f4"
type: "task"
title: "`ndx trust accept .` tells a user with a repository test command there is \"Nothing to trust\""
slug: "ndx-trust-accept-tells-a-user-with-a"
description: "Verdict: should-fix (low). Found in the adversarial review of task 48f5ce09 (verify_criteria gate).\n\nScenario: a checkout whose only deviation is a plain `.rex/config.json` `test` command evaluates `baseline`. verify_criteria now refuses to run that command until a matching trust record exists, and its note says to run `ndx trust accept .`. When the user does, `packages/hench/src/cli/commands/trust.ts:51` prints \"Nothing to trust: this repository's execution config matches the defaults. Recorded anyway.\" That tells them the accept was pointless, when the record is exactly what lets verify_criteria run the command. `ndx trust .` (status) on the same checkout reports baseline the same way.\n\nReachable: `ndx trust accept .` / `hench trust accept .` right after a verify_criteria refusal.\n\nOptions: (1) in the baseline branch, when `before.config.testCommand` is set, say the record lets verify_criteria run that command and name it. Cheap, no shape change. Recommended. (2) Make a test command a warning finding so the checkout is never baseline. That would restrict hench's guard for every repo with a test command, which costs too much.\n\n#686 finding 2, which this follows up:\n\n> **Fix:** treat any repository-owned test command as needing trust (an accepted digest) before `verify_criteria` runs it. Add a test with a plain, non-chained command.\n\nCaptured during the T2 run (48f5ce09); kept in layer 1 by Ryan on 2026-10-16 and run after T3."
acceptanceCriteria:
  - "Closes #686 (finding 2, follow-up): accepting is the step verify_criteria's refusal asks for, so `ndx trust accept .` must not call it pointless"
  - "On a baseline checkout with a test command, `ndx trust accept .` names the test command and says the record lets verify_criteria run it, instead of \"Nothing to trust\""
  - "On a baseline checkout with no test command, the existing message is unchanged"
  - "A hench test of cmdTrust covers both cases"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
