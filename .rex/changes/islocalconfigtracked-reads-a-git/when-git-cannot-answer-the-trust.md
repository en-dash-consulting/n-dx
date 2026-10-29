---
id: "3bc4c88a-66f3-42f4-8849-9f0b6b42eb50"
type: "task"
title: "When git cannot answer, the trust review says the repository commits .n-dx.local.json and tells the user to git rm --cached it"
slug: "when-git-cannot-answer-the-trust"
description: "**Severity:** medium · **Verdict:** should-fix (adversarial review of 92cd4988, run 5b6f11b7).\n\n**Failure scenario.** In a devcontainer/WSL checkout where git reports `detected dubious ownership` (exit 128), the user's own untracked `.n-dx.local.json` now counts as tracked (fail closed, correct). But `isLocalConfigTracked` (packages/llm-client/src/repo-trust.ts:420) returns a plain boolean, so the `local-config-tracked` finding (repo-trust.ts:801) says \"Commits .n-dx.local.json\" and the untrusted warning (repo-trust.ts:1122-1125) tells the user to \"untrack it (git rm --cached)\". That diagnosis is false, and `git rm --cached` fails with the same ownership error. Core's `readConfiguredClaudePath` (packages/core/claude-integration.js:492) skips the user's `cli.claudePath` silently in the same state. The change's own recommended option 1 asked for the wording (\"say git could not confirm the file is untracked\"); task 92cd4988's criteria omitted it.\n\n**Reachability.** `ndx work` / `ndx init` / `ndx trust` / pair review in any checkout git refuses, the environment this change targets. Security holds; the guidance is wrong.\n\n**Options.**\n1. (Recommended) Make the tracked check tri-state (`tracked` | `untracked` | `unanswered`), carry it on `collectRepoExecutionConfig` (e.g. `localConfigTrackedReason`), and when unanswered word the finding and warning as \"git could not confirm .n-dx.local.json is untracked (<git's first stderr line>); fix git (e.g. `git config --global --add safe.directory <root>`) or run `ndx trust accept .`\". Cost: small; changes one finding message and the result shape. Risk: digest unchanged, so none to stored trust.\n2. Keep the boolean and soften both messages to cover both causes. Cheaper, less precise.\n\nKept in layer 2 by the session on 2026-10-27 (the follow-up calls Ryan handed over), to run after f11618dd, which edits the same module."
acceptanceCriteria:
  - "Closes #686 (follow-up): when git cannot say whether .n-dx.local.json is tracked, the trust review says that, not that the repository commits it"
  - "With a stub git exiting 128 inside a work tree, the local-config-tracked finding message says git could not confirm the file is untracked and does not say the repository commits it"
  - "In that state the untrusted warning does not recommend git rm --cached and names fixing git (safe.directory) or ndx trust accept"
  - "A file git reports as tracked (exit 0) keeps today's 'Commits …' message and git rm --cached advice"
  - "Test fails on the code before the fix"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
