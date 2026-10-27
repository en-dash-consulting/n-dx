---
id: "922a55ef-397d-45f2-9a10-9e1403136751"
type: "task"
title: "Lock the pack directory for sv pack writers"
slug: "lock-the-pack-directory-for-sv-pack"
description: "Stack review (#772, pack.ts around line 448). Two sv pack writers can share <ndx home>/packs/<ver>: two terminals, two worktrees, or CI jobs on one home. npm takes no lock on a --prefix, so concurrent reifies race on node_modules and package.json. With `add --from`, done.push(name) (around line 444) runs before the renameSync that can fail. If B renames its copy into target between A's existsSync and A's rename, A's rename fails with ENOTEMPTY. A's rollback then rmSyncs target, which is B's freshly installed copy, and has no old copy to restore, while B has already reported success.\n\nFix:\n- take an exclusive lock for add, add --from and remove (`<packDir>.lock`, wx + PID, the same pattern as the PRD lock), and fail loudly naming the holder; handle a stale lock whose PID is dead;\n- push to done only after the rename succeeds;\n- add a \"don't run two sv pack writers\" note to the concurrency docs.\n\nTests: a second writer while the lock is held fails naming the PID; a stale lock is taken over; a failing rename leaves another process's install untouched."
acceptanceCriteria:
  - "add, add --from and remove take an exclusive pack-dir lock and fail loudly naming the holder; stale locks are recovered"
  - "done records a package only after its rename succeeds, so a rollback never deletes another writer's install"
  - "Concurrency docs note the rule; tests cover lock, stale lock and rename failure"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Reuse the repo's existing lock pattern (the PRD file lock: wx + PID, fail loudly naming the holder, stale-lock handling) rather than inventing a new one; if a shared helper exists in a package sourcevision may import, use it. Root AGENTS.md has a byte budget; put concurrency notes in sourcevision's AGENTS.md or docs."}
tags:
  - "review-fixes"
  - "sourcevision"
  - "concurrency"
  - "pr-20"
source: "review"
---
