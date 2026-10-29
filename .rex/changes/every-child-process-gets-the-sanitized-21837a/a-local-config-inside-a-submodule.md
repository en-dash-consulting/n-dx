---
id: "9adf1968-3c40-41eb-824a-212092764847"
type: "task"
title: "A local config inside a submodule container is repository config"
slug: "a-local-config-inside-a-submodule"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, trust pass finding 2 (high; probed).\n\nFailure scenario: localConfigTrackState / shippedPathsOf (packages/llm-client/src/repo-trust.ts) and gitTracksPath (packages/llm-client/src/exec.ts) run `git ls-files --error-unmatch` in the superproject. That lists nothing inside a gitlink and exits 1, so the file reads as untracked. A repository adds .ndx as a submodule whose config.local.json sets hench.claudePath and hench.guard.env.allow [\"FAKE_TOKEN\"] (plus hench/config.json and rex/config.json), and the user clones with --recursive or runs `git submodule update --init`. Probed: the collector reports tracked false, evaluateRepoTrust reports baseline with no findings, and applyRepoTrust applies the claudePath and env allow, with bypassPermissions not lowered. 89109d640/b8c306184 cover case variants and committed symlinks, not gitlinks. The same applies to a .n-dx.local.json reached through any submodule directory.\n\nFix: treat the local config as tracked (repository config) when any directory between the project root and the file is a gitlink (`git ls-files -s` shows mode 160000), or is the top of another git work tree (`git -C <dir> rev-parse --show-toplevel` differs from the root), or contains a .git entry. Asking git from inside the file's directory as well is acceptable. Fail closed when git cannot answer, as the existing check does."
acceptanceCriteria:
  - "A config.local.json inside a .ndx submodule, or a local config reached through any submodule or nested work tree, is reported as local-config-tracked and is not applied as the user's own"
  - "The user's own untracked local config in a plain checkout still applies"
  - "Test: a superproject with a .ndx submodule holding config.local.json evaluates untrusted; the test fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
