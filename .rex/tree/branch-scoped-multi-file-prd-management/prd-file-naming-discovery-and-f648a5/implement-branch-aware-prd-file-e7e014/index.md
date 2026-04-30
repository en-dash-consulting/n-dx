---
id: "e7e01442-70f8-42bf-8763-d31afb20acf9"
level: "task"
title: "Implement branch-aware PRD file naming convention and git branch/commit resolution"
status: "completed"
priority: "critical"
tags:
  - "rex"
  - "storage"
  - "git"
source: "smart-add"
startedAt: "2026-04-22T16:18:39.803Z"
completedAt: "2026-04-22T16:24:16.600Z"
resolutionType: "code-change"
resolutionDetail: "Added branch-naming.ts with sanitizeBranchName, resolveGitBranch, getFirstCommitDate, generatePRDFilename, resolvePRDFilename. 26 unit tests covering pure functions and git-dependent edge cases. Exported from store/index.ts and public.ts."
acceptanceCriteria:
  - "Generates filenames matching the pattern prd_{sanitized-branch}_{YYYY-MM-DD}.json"
  - "Branch names with slashes and special characters are sanitized to filesystem-safe equivalents"
  - "Detached HEAD state falls back to a deterministic identifier rather than crashing"
  - "First-commit date is extracted from git log for the current branch"
  - "Returns consistent filename when called multiple times on the same branch"
description: "Add utility functions to detect the current git branch name, resolve the date of the branch's first commit, sanitize branch names for filesystem use (slashes, special characters), and generate filenames in the prd_{branch}_{date} format. Handle edge cases like detached HEAD, branches with path separators, and repositories with no commits yet."
---

# Implement branch-aware PRD file naming convention and git branch/commit resolution

🔴 [completed]

## Summary

Add utility functions to detect the current git branch name, resolve the date of the branch's first commit, sanitize branch names for filesystem use (slashes, special characters), and generate filenames in the prd_{branch}_{date} format. Handle edge cases like detached HEAD, branches with path separators, and repositories with no commits yet.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** rex, storage, git
- **Level:** task
- **Started:** 2026-04-22T16:18:39.803Z
- **Completed:** 2026-04-22T16:24:16.600Z
- **Duration:** 5m
