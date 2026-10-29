---
id: "47654649-c6f7-4277-a156-d5d606f9ed2c"
type: "task"
title: "The local-config-tracked finding gives git rm --cached advice that fails for a case-variant or symlinked local config"
slug: "the-local-config-tracked-finding-gives"
description: "Adversarial review of 3e9eafaa (run c288af52), low, should-fix.\n\nScenario: a repository commits `.N-DX.local.json`, or reaches `.ndx/config.local.json` through a committed symlinked `.ndx`. isLocalConfigTracked now (correctly) says tracked, but the finding message (packages/llm-client/src/repo-trust.ts, `local-config-tracked`: \"Commits <file>…\") and formatRepoTrustReport's advice (\"untrack it (git rm --cached)\") name the path n-dx opens (`.n-dx.local.json`, `.ndx/config.local.json`), which git does not list. Following the advice fails with \"pathspec did not match\", and for the symlink shape the thing to untrack is the symlink or the target, not the named file.\n\nReachable: `ndx trust .`, `ndx init`'s trust review, the run-time trust warning. Gate itself is correct; only the remediation text is wrong.\n\nOptions: (a) have localConfigTrackState return which shipped path git matched (the case variant, the symlinked directory, or the real path) and name that one in the message and the advice — small, recommended; (b) drop the git rm advice when the matched path differs from the opened one, keeping only `ndx trust accept .` — smaller, less helpful."
acceptanceCriteria:
  - "For a committed .N-DX.local.json, the local-config-tracked finding and report name .N-DX.local.json (the path git tracks), not .n-dx.local.json"
  - "For a config.local.json reached through a committed symlinked .ndx, the report names the committed symlink or target instead of advising git rm --cached .ndx/config.local.json"
  - "Test in packages/llm-client/tests/unit/local-config-tracked.test.ts asserts the named path for both shapes"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
source: "ndx-adversarial-review"
---
