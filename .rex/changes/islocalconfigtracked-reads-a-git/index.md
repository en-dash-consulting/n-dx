---
id: "139b71eb-523f-43c3-9ce9-c015ab551cfc"
type: "change"
title: "isLocalConfigTracked reads a git failure as \"untracked\", so a committed .n-dx.local.json applies as the user's own when git cannot answer"
slug: "islocalconfigtracked-reads-a-git"
intent: "**Severity:** medium · **Verdict:** should-fix (found by the adversarial review of 0681b775, run 2fe1f329).\n\n**Failure scenario.** `isGitTracked` (packages/llm-client/src/exec.ts, used by `isLocalConfigTracked` in packages/llm-client/src/repo-trust.ts) returns false whenever `git ls-files --error-unmatch` throws. That covers \"not tracked\" (exit 1), and also every case where git cannot answer: a checkout git refuses as `detected dubious ownership` (exit 128; common with Docker/devcontainer volume mounts, WSL, or a clone owned by another uid), git missing from PATH while `.git` exists, a corrupt index, or the 5 s timeout. In each of those, a `.n-dx.local.json` the repository commits reads as the user's own. Its `hench.guard.env.allow`, `cli_path`, `claudePath` and `api_endpoint` then apply in an untrusted checkout with no `local-config-tracked` finding: the fail-open that change b6df6203 closed. Core's `isGitTracked` (packages/core/gitignore.js), used by `readConfiguredClaudePath` in packages/core/claude-integration.js, has the same shape.\n\n**Reachability.** Any `ndx work` / `ndx init` / pair review / `rex verify` in such a checkout. The attacker controls the content, not the ownership, so this needs an environment that already produces the git error.\n\n**Options.**\n1. (Recommended) Separate exit 1 (git answered \"not in the index\") from every other outcome. When the project root sits inside a git work tree (a `.git` entry found walking up) but git could not answer, treat the file as tracked (fail closed) and word the finding so it says git could not confirm the file is untracked. Cost: a small change to both helpers plus tests. Risk: users in dubious-ownership checkouts see their own local settings held until they trust or fix `safe.directory`.\n2. Treat only the dubious-ownership error as tracked. Narrower, but leaves the missing-git and timeout cases open."
acceptanceCriteria:
  - "In a git-initialised fixture that commits .n-dx.local.json with hench.guard.env.allow naming a credential-shaped variable, when the git spawn fails with a non-1 exit (e.g. a stub git on PATH exiting 128), repoCommandEnv strips that variable and the trust evaluation is not baseline"
  - "Outside any git work tree (no .git found walking up), an existing .n-dx.local.json still applies as the user's own"
  - "core's readConfiguredClaudePath does not run a cli.claudePath from .n-dx.local.json when git fails inside a git work tree (sentinel-script test)"
  - "A file git reports as untracked (exit 1) keeps applying, as today"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"0681b775-d1e2-4c19-9d82-c5e55cb1f09f","run":"2fe1f329-b2b8-49d6-abab-f3cb8206d289"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
