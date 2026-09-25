---
id: "c3ab0b13-7ac7-4760-a594-cc143b595f93"
level: "feature"
title: "Refresh task claims for as long as the run lasts"
status: "completed"
priority: "high"
tags:
  - "pr-06"
  - "hench"
source: "PR 371 review, 2026-09-17 — carried over after that branch was closed as superseded"
startedAt: "2026-09-17T19:40:00.000Z"
completedAt: "2026-09-17T19:57:15.995Z"
endedAt: "2026-09-17T19:57:15.995Z"
resolutionType: "code-change"
resolutionDetail: "TaskClaims.startRenewal/stopRenewal/renewNow in packages/hench/src/process/task-claims.ts; run.ts starts renewal beside the claims instance and releaseAll stops it. The timer re-aims at half the time left on the claim that lapses soonest, read from the claim the store returned rather than a TTL constant."
acceptanceCriteria:
  - "A claim refreshed across six hours is still visible to another worktree, where an unrefreshed claim on the same clock has already lapsed."
  - "A refresh moves expiresAt forward and leaves claimedAt unchanged."
  - "A refusal during renewal drops the task from held, so releaseAll cannot release a claim another worktree now owns."
  - "The renewal timer is unref'd and is cleared by releaseAll."
description: "A claim carries a four-hour expiry as well as a pid, and both must fail before it is ignored. The pid covers crash, kill and reboot; the expiry covers what the pid cannot see — a live process that has wandered off the task, and any claim written on another machine where kill(pid, 0) is meaningless.\n\nThat expiry is why a claim has to be refreshed. A run longer than the TTL lets its own claim lapse while it is still working, and the next worktree to select walks straight onto the task. Runs that long are ordinary: an --epic-by-epic pass over a large epic outlives four hours comfortably.\n\nThe run now refreshes on a self-rescheduling timer rather than assuming it will finish first. The interval is derived from the claim the store actually wrote, so it cannot drift from the TTL constant, and is clamped to a 30s floor and a 15min ceiling. A refusal means the claim lapsed and another worktree took over: the run continues, because abandoning work in progress is worse than the overlap, but the task leaves `held` so this run can never release someone else's claim."
lastModified: "2026-09-17T19:57:15.995Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
