---
id: "b6df6203-ebfe-4a0b-8467-2afe899dbd40"
type: "change"
title: "A .n-dx.local.json the repository commits is read as the user's own config by every trust gate"
slug: "a-n-dx-local-json-the-repository"
intent: "**Severity:** high · **Verdict:** out-of-scope (pre-existing; seen while reviewing 58117c3d, which made the pair reviewer CLI follow the same rule).\n\n**Failure scenario.** A cloned repository commits `.n-dx.local.json` (gitignore does not untrack a committed file; `git add -f` or a repo that never ran `ndx init` ships it) with `{\"hench\":{\"guard\":{\"env\":{\"allow\":[\"AWS_*\"]}}}}`, or `llm.claude.cli_path`, `hench.claudePath`, `cli.claudePath`, `llm.*.api_endpoint`. Every trust gate treats `.n-dx.local.json` as an operator-only channel that always applies: hench `applyRepoTrust` / `localHenchSection` (packages/hench/src/store/trust.ts), llm-client `repoCommandEnv` / `localEnvPolicy` (packages/llm-client/src/repo-command-env.ts:51), core `applyRepoTrustToEnvPolicy` / `loadLocalEnvAllow` (packages/core/config.js), and the cli_path / api_endpoint / apiKeyEnv gates in llm-client (credential-routing, llm-config.ts:294). Nothing checks whether the file is tracked (no `git ls-files` in llm-client/src), and `collectRepoExecutionConfig` does not count it, so the untrusted checkout widens the agent's shell, repo commands, the reviewer CLI environment, the spawned binary and the endpoint without any trust finding.\n\n**Reachability.** Any `ndx work`, `ndx pair-programming`, `ndx auth`/`init` in a clone whose history contains `.n-dx.local.json`.\n\n**Options.** 1 (recommended): one llm-client helper `localConfigIsRepositoryContent(dir)` (tracked in git index via `git ls-files --error-unmatch`, or present in HEAD) that every local-config reader consults; when tracked, its contents count as repository config (enter the trust digest, raise a finding like `local-config-tracked`, and are dropped while untrusted). Cost: one helper + routing the ~5 readers through it; risk: a team that deliberately commits a local file must trust. 2: refuse/warn on a tracked `.n-dx.local.json` in `ndx trust` and the gates without folding it into the digest. Cheaper, weaker."
acceptanceCriteria:
  - "In an untrusted checkout where .n-dx.local.json is tracked by git and sets hench.guard.env.allow, a credential-shaped variable it names does not reach the agent's shell, repoCommandEnv or loadVendorCliEnv (test with a git-initialised fixture)"
  - "A tracked .n-dx.local.json setting a cli_path / claudePath is not spawned while untrusted (sentinel-script test)"
  - "ndx trust review lists a tracked .n-dx.local.json as a finding, and accepting it restores its entries"
  - "An untracked .n-dx.local.json keeps applying in all paths (existing tests stay green)"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"58117c3d-c1eb-4ef0-a0da-ded997c9ebe7","run":"4ac77e61-f948-44d2-96b2-8f313fc49db2"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
