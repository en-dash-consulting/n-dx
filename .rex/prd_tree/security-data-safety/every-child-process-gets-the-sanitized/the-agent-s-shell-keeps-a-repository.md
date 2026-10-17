---
id: "942e0619-903d-4343-b07f-91d95f337327"
level: "task"
title: "The agent's shell keeps a repository-supplied guard.env.allow while the repository is untrusted, unlike repository commands"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): while the repository is untrusted, the agent's shell drops repository-supplied guard.env.allow entries, as repository commands do"
  - "Decision (Ryan, 2026-10-16): option 1. While untrusted or changed, applyRepoTrust drops guard.env.allow entries the repository ships (.hench/config.json, the hench section of .n-dx.json); .n-dx.local.json entries and every deny entry still apply"
  - "The trust warning for env-allow-added tells the operator to move a credential their own tests need into .n-dx.local.json, or to run `ndx trust accept .`"
  - "The repo-trust.ts header comment that explains warning rather than clamping is updated to the new rule"
  - "The layer changeset gets a line for the behaviour change: an untrusted checkout's guard.env.allow no longer reaches the agent's shell"
  - "In an untrusted checkout with guard.env.allow naming a sentinel variable, run_command's child does not see it, and it does once trusted (test asserting presence only)"
description: "Verdict: out-of-scope (pre-existing and documented as deliberate in the llm-client repo-trust.ts header). It surfaced while reviewing task fc21d703.\n\nScenario: an untrusted clone ships `guard.env.allow: [\"AWS_*\"]`. `applyRepoTrust` (packages/hench/src/store/trust.ts) clamps commands, git subcommands and blocked paths, but leaves `guard.env` alone. `GuardRails.childEnv` (packages/hench/src/guard/index.ts:124) is used by run_command and git, and it keeps those variables. A prompt-injected run_command (`printenv`, `curl`) then reads them. Since fc21d703, the test gate and the other repository-owned commands drop the same entry while untrusted. The agent's shell, which runs model-chosen commands, is now the looser of the two.\n\nDecision needed: the repo-trust header chose to warn rather than clamp because an operator's intended allow entry looks the same as one the repository planted. The user's .n-dx.local.json is now an operator-only channel that `repoCommandEnv` always honours, which removes that ambiguity.\n\nOptions:\n1. (Recommended) While untrusted, `applyRepoTrust` drops repository-supplied `guard.env.allow` entries, keeping .n-dx.local.json entries and deny. The trust warning tells operators to move a credential their tests need into .n-dx.local.json or to run `ndx trust accept .`.\n2. Keep the current behaviour and record the decision in docs.\n\nDecision (Ryan, 2026-10-16): option 1, clamp.\n\n#686 finding 3, which this follows up:\n\n> **Fix:** thread the sanitized child environment (or a single safe-environment builder) through every subprocess caller: tests, gate, audit, and rex. Add an integration test that fails if a sentinel credential is visible to the test command.\n\nCaptured during the T4 run (fc21d703); kept in layer 2 by Ryan on 2026-10-16."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-17T01:22:03.023Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
