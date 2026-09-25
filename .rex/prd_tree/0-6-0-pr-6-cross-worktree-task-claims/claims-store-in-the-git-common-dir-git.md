---
id: "67115804-a580-4b38-af7b-5b3629f20a06"
level: "feature"
title: "Claims store in the git common dir: .git/ndx/claims.json with pid, worktree, task id and expiry"
status: "completed"
priority: "high"
tags:
  - "pr-06"
  - "rex"
blockedBy:
  - "811cf124-3b65-4623-b72f-bfc000229d6a"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T17:07:50.415Z"
completedAt: "2026-09-16T17:14:07.673Z"
endedAt: "2026-09-16T17:14:07.673Z"
resolutionType: "code-change"
resolutionDetail: "packages/rex/src/store/claims.ts: openClaimsStore(projectDir) at <git common dir>/ndx/claims.json with lock + atomic writes, pid-liveness + 4h TTL, no-op outside a repo; 11 unit tests incl. two-process race."
acceptanceCriteria:
  - "Unit tests: claim/release round trip, dead-pid claim ignored, expired claim ignored, concurrent claim from two processes yields one winner, non-repo no-op."
description: "In packages/rex/src/store add claims.ts: locate the store via getGitCommonDir(projectDir) (llm-client helper from PR 2) → <commonDir>/ndx/claims.json; API: readClaims(), claim(taskId, { worktreeRoot, pid, ttlMs }), release(taskId, pid), isClaimedByOther(taskId, { worktreeRoot, pid }). Atomic writes (reuse atomic-write.ts), advisory file lock (reuse file-lock.ts pattern with a claims.lock), PID-liveness check (process.kill(pid, 0)) plus expiry (default 4 h). Never tracked by git (it lives inside .git). Return a no-op store when not in a git repo."
lastModified: "2026-09-16T17:14:08.047Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
