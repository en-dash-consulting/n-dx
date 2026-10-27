---
id: "0681b775-d1e2-4c19-9d82-c5e55cb1f09f"
type: "task"
title: "A .n-dx.local.json the repository tracks counts as repository config in every trust gate"
slug: "a-n-dx-local-json-the-repository"
description: "Fix for change b6df6203, found by the adversarial review of 58117c3d (run 4ac77e61). Every trust gate on this branch treats .n-dx.local.json as the user's own channel and always applies it: hench applyRepoTrust / localHenchSection (packages/hench/src/store/trust.ts), llm-client repoCommandEnv / localEnvPolicy (repo-command-env.ts), credential-routing's trustedProjectConfig (api_endpoint, apiKeyEnv, cli_path), core applyRepoTrustToEnvPolicy / loadLocalEnvAllow (config.js), and the claudePath / cli.claudePath readers. The assumption is stated in repo-trust.ts: the file 'is git-ignored and theirs'. A repository can simply commit it. The session reproduced it on this branch: in a git checkout that commits .n-dx.local.json allowing a variable, repoCommandEnv passes that variable and ndx trust reports 'matches the defaults (nothing to trust)'; without the file the variable is stripped.\n\nFix, the review's option 1: one llm-client helper that says whether the local config file is repository content (tracked in the git index). Every local-config reader that bypasses trust consults it. When tracked, the file's contents count as repository config: they enter the trust assessment and digest with a finding (for example local-config-tracked, warning), and are dropped while the checkout is untrusted or changed. An untracked file keeps applying everywhere, as today. A checkout that is not a git repository keeps today's behaviour; say so in the changeset. If the helper spawns git, keep packages/core/child-process-allowlist.json and the shell-spawn inventory in step.\n\nKept in layer 2 by the session on 2026-10-27 (Ryan handed it the remaining runs and follow-up calls): every gate that always applies the local file is a layer-2 gate, so the fix lands here. Runs last.\n\nRetry note (session, 2026-10-27): the first run (2fe1f329) committed the fix as adb87b010, and its gate failed on two things only. (1) Hench integration fixtures (run-resolve.test.ts projectConfig, run-per-task-settings.test.ts, task-run-settings.test.ts) write .n-dx.local.json and then commit the whole tree to keep it clean, so the file is now, correctly, tracked repository content. Fix the fixtures, not the rule: have them gitignore the local config file before committing, as ndx init does, so it stays the user's own. (2) tests/e2e/layout-literal-policy.test.js flags the literal \".n-dx.local.json\" fallback in packages/llm-client/src/repo-trust.ts (the local-config-tracked finding message); take the name from the layout resolver instead. Keep adb87b010's behaviour."
acceptanceCriteria:
  - "Closes #686 (follow-up): a .n-dx.local.json the repository tracks cannot widen what n-dx runs or which credentials reach a child process until the user trusts the checkout"
  - "In an untrusted checkout where .n-dx.local.json is tracked by git and sets hench.guard.env.allow, a credential-shaped variable it names does not reach the agent's shell, repoCommandEnv or loadVendorCliEnv (test with a git-initialised fixture)"
  - "A tracked .n-dx.local.json setting a cli_path / claudePath is not spawned while untrusted (sentinel-script test)"
  - "ndx trust review lists a tracked .n-dx.local.json as a finding, and accepting it restores its entries"
  - "An untracked .n-dx.local.json keeps applying in all paths (existing tests stay green)"
  - "This repository's own trust state does not change (its .n-dx.local.json is untracked)"
  - "Tests fail on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
