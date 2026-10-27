---
id: "5fe55ced-a1dd-4c54-b471-647ede89caf4"
type: "capability"
title: "Refuse to mark a task completed while its work is uncommitted"
slug: "refuse-to-mark-a-task-completed-while"
statement: "Hench refuses to mark a task completed while the working tree holds uncommitted work other than hench runtime artifacts, and recovers forked task sessions that wrongly treat themselves as read-only."
criteria: [{"id":"c1","text":"If a task's agent leaves files uncommitted when the run ends, hench shall not set the task's status to completed and shall report the uncommitted paths."},{"id":"c2","text":"When a task's work is fully committed, hench shall mark the task completed without any added step."},{"id":"c3","text":"When hench decides whether the working tree is dirty before completion, it shall not count hench runtime artifacts (.hench/locks, .hench/runs, usage cursors), the same artifacts the pre-run gate ignores."},{"id":"c4","text":"While the previous task's output is uncommitted, a --loop run shall not start the next task."},{"id":"c5","text":"Hench shall remove scratch files that the agent writes into the repository root, such as root-test-output.log."},{"id":"c6","text":"When hench forks the warm orientation parent for a task spawn, it shall start the brief section of that spawn's first user turn with the exported fixed sentence that lifts orientation's read-only instruction."},{"id":"c7","text":"Hench shall leave the lift sentence out of cold spawns, batch resumes, retry-resumes and background-wait resumes."},{"id":"c8","text":"Hench shall use the same task-free bytes for the lift sentence in every fork."},{"id":"c9","text":"The orientation prompt builders, with and without a primer, and the orientation system prompt builder shall limit the read-only instruction to the orientation session."},{"id":"c10","text":"When hench re-spawns a forked attempt in plan mode, it shall still include the lift sentence."},{"id":"c11","text":"If a forked attempt produces no diff and makes no file-edit tool calls, hench shall report it as a read-only refusal and re-spawn the task cold exactly once in the same run, without using retry budget."},{"id":"c12","text":"If a forked attempt produces no diff but makes at least one file-edit tool call, hench shall reject completion with the standard no-changes reason."},{"id":"c13","text":"If a cold (non-forked) attempt produces no diff, hench shall reject completion with the standard no-changes reason."},{"id":"c14","text":"When hench retries a read-only refusal, the run record shall name the read-only refusal and the spawn reason for the cold retry."},{"id":"c15","text":"When hench detects a read-only refusal, it shall keep the session cache entry for the warm parent."},{"id":"c16","text":"If the cold retry after a read-only refusal also makes no changes, hench shall fail the run with the standard no-changes reason."}]
tags:
  - "hench"
  - "gh-363"
source: "GitHub issues #362-#365, filed from the wave-1 session 2026-09-11"
priority: "critical"
---

GitHub #363. Severity: critical — silent loss of finished work, and the status field reports the opposite of the truth.

FAILURE SCENARIO
A task's agent writes its files, the run ends, and only the PRD status commit lands:

  chore(prd): commit PRD tree changes (task <id> completed)

The code sits uncommitted in the working tree. Observed three times in one session: task 6879f7b0 left packages/hench/tests/unit/process/git-origin.test.ts (105 lines, 18 passing tests) plus a stray root-test-output.log; tasks 63592288 and 9f0a2b51 together left 15 files including README, CLAUDE.md, three guides, the shared project-guidance asset, two changesets and a new rex module. Recovered by hand in a306968d and 71c676c5.

It compounds in a --loop run: the next task starts on a tree still holding the previous task's output, so the files tangle together, and the pre-run commit gate then refuses to start because of them.

SOLUTION
Before writing status: completed, check whether the working tree is dirty (excluding the hench runtime artifacts already discounted by the pre-run gate — see excludeHenchRuntimeArtifacts in packages/hench/src/store/artifacts.ts). If it is dirty, either commit it as part of completion or fail the task loudly naming the uncommitted paths. Do not report success.

Also clean up scratch files the agent writes into the repo root (root-test-output.log was left behind).
