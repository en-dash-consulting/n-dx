---
id: "92cd4988-0eff-49ab-a62c-eb3bd880c28b"
type: "task"
title: "Inside a git work tree, a git failure counts the local config file as tracked"
slug: "inside-a-git-work-tree-a-git-failure"
description: "Fix for change 139b71eb, found by the adversarial review of 0681b775 (run 2fe1f329): isGitTracked (llm-client exec.ts) and core's isGitTracked (gitignore.js) read every git failure as untracked, so a committed .n-dx.local.json applies as the user's own whenever git cannot answer (dubious ownership, git missing, corrupt index, timeout). Fix, the review's option 1: only git's own 'not in the index' answer (exit 1) means untracked; any other failure while the project sits inside a git work tree (a .git entry found walking up) counts as tracked, so the file is gated until trusted. Outside a work tree the file keeps applying. Kept in layer 2 by the session on 2026-10-27; runs after 0681b775."
acceptanceCriteria:
  - "Closes #686 (follow-up): a committed .n-dx.local.json cannot apply as the user's own because git failed to answer"
  - "In a git-initialised fixture that commits .n-dx.local.json with hench.guard.env.allow naming a credential-shaped variable, when the git spawn fails with a non-1 exit (e.g. a stub git on PATH exiting 128), repoCommandEnv strips that variable and the trust evaluation is not baseline"
  - "Outside any git work tree (no .git found walking up), an existing .n-dx.local.json still applies as the user's own"
  - "core's readConfiguredClaudePath does not run a cli.claudePath from .n-dx.local.json when git fails inside a git work tree (sentinel-script test)"
  - "A file git reports as untracked (exit 1) keeps applying, as today"
  - "Tests fail on the code before the fix"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
