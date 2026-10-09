---
id: "7a91cfb7-1b41-4336-837f-0d8b2a5aad56"
level: "task"
title: "Write one final trailer block on every hench commit"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "A work commit through the commit prompt gives the task id from `git log -1 --format='%(trailers:key=N-DX-Item,valueonly)'`, whether the agent's message ends with or without a newline and with or without its own trailers (test, asserted through git's parser, never a regex over the message)"
  - "N-DX, N-DX-Item and Co-Authored-By sit in one final trailer block on every hench-built commit message (test)"
  - "The agent commit guidance says to write all trailers as one final block with no blank line between them"
description: "From Ryan's review of #605 (2026-10-08 23:18Z and 23:33Z). The work-commit path, performCommitPromptIfNeeded in packages/hench/src/agent/lifecycle/shared.ts (~line 2998), appends N-DX, N-DX-Item and Co-Authored-By one at a time with a separator that can leave N-DX-Item in a separate paragraph, where git's trailer parser (`%(trailers:key=N-DX-Item)`, used by rex's computeChangeCommits) cannot see it. Agent-written commits split the same way (c40510b5c, d718b6c15, 2d38ade41 on main: N-DX-Item / blank line / Co-Authored-By); since 2026-10-06 only 13 of the 21 main commits that carry an N-DX-Item line have one git can read. Find every path that builds a hench commit message (shared.ts commit prompt and PRD-write commits ~line 2365, run.ts, pr-status-trailers.ts) and the guidance that tells agents how to commit (packages/hench/src/agent/planning/prompt.ts ~lines 123-124, system prompt), and make all of them produce one final trailer block. Reuse the git-parser test helper from the review-repair trailer task."
lastModified: "2026-10-09T03:21:15.976Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
