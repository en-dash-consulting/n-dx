---
id: "80bf4e58-26ac-4903-8bcb-a5f41e8e7c61"
level: "task"
title: "Agent-written work commits carry the task's N-DX-Item"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "The task brief for a run names the exact trailer lines with the task id (`N-DX-Item: <taskId>`) and says to end the commit message with them as one final block; the system prompt contains no task id (test)"
  - "After a run, a commit since startHead whose `git log -1 --format='%(trailers:key=N-DX-Item,valueonly)'` is not the task id is recorded on the run record and printed in the run summary (test with a fixture commit lacking the trailer, through git's parser)"
  - "A run whose commits all carry the task id records no such warning (test)"
  - "No agent commit is amended or rewritten by hench"
description: "Found verifying run aac21a47 on this branch (Ryan's decision 2026-10-09: include in the PR 5 follow-ups). When the agent commits its own work (the autoCommit path, used by `ndx work --yes`), hench adds no trailers to that commit and the agent is never told the task id or the N-DX-Item line: packages/hench/src/agent/planning/prompt.ts (~lines 120-128) only says to keep trailers in one block. Run aac21a47's work commit 7c6afb045 carries only Co-Authored-By; the earlier runs on this branch carried N-DX-Item only because their task descriptions were about trailers. On main since 2026-10-06, 362 non-merge commits with a Claude co-author have no N-DX-Item git can read, which is most of why only 13 of 398 commits are attributable. The one-final-block work (appendTrailerBlock in agent/lifecycle/commit-trailers.ts) covers commits hench writes, not this path. Approach: put the exact trailer lines (`N-DX: <vendor>/<model> · run <runId>` as the commit prompt writes it, `N-DX-Item: <taskId>`) in the per-task brief (agent/planning/brief.ts), not in the system prompt, which is built per project and must stay task-independent; tell the agent to end its commit message with them as one final block alongside its own Co-Authored-By. Do not amend or rewrite the agent's commits. After the run, check each commit since the run's startHead with git's parser and record on the run (and print) any whose N-DX-Item is not the task id, so a missing trailer is visible rather than silent. Re-record the prompt census (node scripts/prompt-census.mjs --write, on a clean tree after committing) if the brief's fixed text changes it. Before finishing, run `pnpm build` in packages/hench: the test gate reads hench through dist/ and fails a run that edits source without rebuilding (the stale-dist failure of run 31bed159)."
lastModified: "2026-10-09T04:11:18.891Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
