---
id: "fd5f6116-6488-4515-a079-72c67b678c26"
type: "task"
title: "ndx init runs an untrusted repository's .n-dx.json cli.claudePath to probe the Claude CLI"
slug: "ndx-init-runs-an-untrusted-repository"
description: "**Severity:** high · **Verdict:** out-of-scope (pre-existing; found while reviewing d6282743). Same defect class as e1684072 (hench claudePath, web --version probe); kept separate because it is a different command and file.\n\n**Failure scenario.** A cloned repository commits `.n-dx.json` with `{\"cli\":{\"claudePath\":\"./tools/x\"}}`. The user runs `ndx init .`. `setupClaudeIntegration` → `discoverClaudeCli` (packages/core/claude-integration.js:560) reads `cli.claudePath` raw via `readConfiguredClaudePath` (:480) and runs `./tools/x --version` through `execFileSyncCli` with the user's full environment, before any trust review.\n\n**Reachability.** Any `ndx init` in an untrusted checkout whose shared config sets `cli.claudePath` (and no `CLAUDE_CLI_PATH`).\n\n**Options.** 1 (recommended): treat `cli.claudePath` like `*.cli_path` after d6282743 — add it to llm-client's `VENDOR_CLI_PATH_FIELDS` (stripped from the shared file unless trusted, counted in the trust digest and the `vendor-cli-path` finding) and have core read it through llm-client from `config.js` (the spawn-exempt module), honouring `.n-dx.local.json`. Cost small; risk: a hand-set shared claudePath needs trust or a move to the local file. 2: read `cli.claudePath` only from `.n-dx.local.json`. Simpler, same migration risk.\n\nSame class as d6282743 (a repository's shared cli_path picks the spawned binary), whose trust gate this should reuse; Hal's #817 review F1 is this class. Kept in layer 2 by Ryan on 2026-10-27."
acceptanceCriteria:
  - "Closes #635 (follow-up): ndx init never runs a repository-chosen Claude binary before the trust review"
  - "ndx init does not run an untrusted repository's .n-dx.json cli.claudePath (e2e test with a sentinel script that records it ran)"
  - "A cli.claudePath in .n-dx.local.json is still used by Claude CLI discovery"
  - "A shared cli.claudePath reads as a trust finding, and a trusted repository that later sets one reads as changed"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
