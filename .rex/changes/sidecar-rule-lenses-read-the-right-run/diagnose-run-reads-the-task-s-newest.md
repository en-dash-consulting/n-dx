---
id: "8cb5a7fc-a5c6-4744-b317-6b7b941b2e4c"
type: "task"
title: "Diagnose run reads the task's newest run in every worktree and tells an orphaned run from a live one"
slug: "diagnose-run-reads-the-task-s-newest"
description: "Review F1 (packet-builders.ts:569) and F2 (packet-sources.ts:552) on #945. F1: a run record left at status running after its process died is told to the model as 'still running', no verdict is spawned and no action offered. F2: taskRun reads only ctx.projectDir's .hench/runs, while Live and Runs (?scope=repo) read every worktree, so a run made in a sibling worktree reads as never run, or an older local run is diagnosed as the newest."
acceptanceCriteria:
  - "taskRun reads the task's runs from every worktree of the repository through the same source list Runs uses (resolveRunSources in routes-hench.ts or a shared helper), takes the newest by startedAt, and the 'Newest run' section names the worktree it came from (tested with two worktrees, the newer run in the sibling)"
  - "When no worktree has a run of the task, the gap says so for the repository; when the newest run is in another worktree, the hench runs diagnose fallback is spawned with that worktree's directory, not ctx.projectDir (tested)"
  - "A record at status running is judged with judgeRunLiveness(livenessInputOf(run), …), the mirror Live uses. An orphaned run is classified (the fallback spawn runs as for an ended run) and its verdict section says the run is recorded as running but its process is gone, and that ending it from Live records the end (tested with a dead pid). A live running run is still never classified, and says it is still running (the existing test keeps passing)"
source: "ndx-capture"
---
