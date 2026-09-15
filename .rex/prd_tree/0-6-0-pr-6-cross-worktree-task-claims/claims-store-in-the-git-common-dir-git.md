---
id: "67115804-a580-4b38-af7b-5b3629f20a06"
level: "task"
title: "Claims store in the git common dir: .git/ndx/claims.json with pid, worktree, task id and expiry"
status: "pending"
priority: "high"
tags:
  - "pr-06"
  - "rex"
blockedBy:
  - "811cf124-3b65-4623-b72f-bfc000229d6a"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Unit tests: claim/release round trip, dead-pid claim ignored, expired claim ignored, concurrent claim from two processes yields one winner, non-repo no-op."
description: "In packages/rex/src/store add claims.ts: locate the store via getGitCommonDir(projectDir) (llm-client helper from PR 2) → <commonDir>/ndx/claims.json; API: readClaims(), claim(taskId, { worktreeRoot, pid, ttlMs }), release(taskId, pid), isClaimedByOther(taskId, { worktreeRoot, pid }). Atomic writes (reuse atomic-write.ts), advisory file lock (reuse file-lock.ts pattern with a claims.lock), PID-liveness check (process.kill(pid, 0)) plus expiry (default 4 h). Never tracked by git (it lives inside .git). Return a no-op store when not in a git repo."
lastModified: "2026-09-10T20:12:04.256Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
