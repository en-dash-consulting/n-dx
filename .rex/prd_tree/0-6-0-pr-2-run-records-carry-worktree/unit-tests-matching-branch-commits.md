---
id: "6879f7b0-ff96-4a8b-a9c0-48cee03a7f30"
level: "task"
title: "Unit tests: matching branch commits; mismatched branch, detached HEAD and worktree-root mismatch are refused"
status: "pending"
priority: "high"
tags:
  - "pr-02"
  - "hench"
  - "tests"
blockedBy:
  - "459aabf9-e7b8-49f4-b013-3c6c34aa77c0"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "All five cases pass; the symlink case proves realpath comparison."
  - "pnpm --filter @n-dx/hench test passes."
description: "Cover the gate from pr2.t2 in packages/hench/tests/unit: (1) same branch and root → commit proceeds; (2) branch changed → refused, message names expected and actual; (3) detached HEAD not at the start commit → refused; (4) detached at the start commit → allowed; (5) worktree root differs (symlinked path vs realpath must NOT be a false mismatch). Mock the gateway helpers rather than spawning git where the existing test style does so."
lastModified: "2026-09-10T20:11:40.464Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
