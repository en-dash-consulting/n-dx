---
id: "9262b097-28b2-4200-83d8-9606cfb75c6e"
type: "change"
title: "The cwd-taking git helpers describe another repository when GIT_DIR or GIT_WORK_TREE is inherited"
slug: "the-cwd-taking-git-helpers-describe"
intent: "listWorktrees, getWorktreeRoot and getGitCommonDir in packages/llm-client/src/exec.ts take an explicit cwd, but spawn git with the inherited process.env. If the calling process carries GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE or GIT_COMMON_DIR (a hench run started from a git hook, a test run from a pre-commit hook), git answers for the repository those variables name, not for cwd. On 2026-11-09 a test run with those variables set wrote fixture commits, a branch and worktree registrations into the real repository.\n\nProposed: these helpers drop git's repository-location variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES, GIT_IMPLICIT_WORK_TREE, GIT_PREFIX) from the child's env, and keep config variables. GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT carry the host's policy (e.g. safe.bareRepository=explicit from the desktop Terminal panel) and must keep reaching git. Runtime behaviour change for hench and the dashboard, so it gets its own PR and review. Found while fixing the bare-repo listWorktrees test (fix/bare-repo-worktree-list)."
acceptanceCriteria:
  - "With GIT_DIR/GIT_WORK_TREE pointing at another repository, listWorktrees, getWorktreeRoot and getGitCommonDir answer for cwd"
  - "GIT_CONFIG_PARAMETERS still reaches git from these helpers (safe.bareRepository=explicit still refuses a bare repository)"
priority: "low"
source: "ndx-capture"
---
