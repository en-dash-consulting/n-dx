---
id: "cf903bc9-379e-4272-bb2d-34e21f04496d"
type: "change"
title: "listWorktrees returns no entry for a bare repository, failing \"a bare repository is a single bare entry\" on macOS"
slug: "listworktrees-bare-repository-audit-duplicate"
intent: "Verdict: out-of-scope (severity medium). Found while running the llm-client suite during the adversarial review of task 0b3b3a8c (run 266dcbab); nothing on that branch touches this code.\n\npackages/llm-client/tests/integration/git-worktree-helpers.test.ts:166 — after `git init --quiet --bare`, `listWorktrees(bare)` returns [] where the test expects one bare entry {path, branch:null, head:null, isMain:true, detached:false, bare:true}. Observed 2026-11-06 on macOS (Darwin 23), tmp path under /private/var/folders. Not diagnosed: it may be the installed git's porcelain output for a bare repo, the /var vs /private/var realpath, or a parser change.\n\nReachability: listWorktrees backs the cross-worktree run views (hench, dashboard). A bare repository is rare as a working project, so user impact is small, but the red test blocks any PR CI that runs llm-client on an affected platform.\n\nOptions: reproduce with `git worktree list --porcelain` in a fresh bare repo and compare to the parser; fix the parser or the path comparison, whichever is wrong. Do not weaken the test."
acceptanceCriteria:
  - "packages/llm-client/tests/integration/git-worktree-helpers.test.ts 'a bare repository is a single bare entry' passes on macOS without changing its expectation"
  - "The cause (git output, path resolution or parser) is named in the fix's commit or a test comment"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
discoveredFrom: {"item":"0b3b3a8c-f6d7-44ec-b289-8c6a2e57205c","run":"266dcbab-7c06-4380-81f6-a48ea9348766"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
