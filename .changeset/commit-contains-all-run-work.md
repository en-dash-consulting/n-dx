---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

A completed task's commit now contains every file the run changed.

Reported from the dashboard's run-task button: files the agent had changed
were missing from the commit, and the task was recorded `completed` anyway.
Two independent causes, both of which committed before the task was verified
complete.

**The commit only ever held what the agent staged.** The prompt asks the
agent to `git add -- <path...>` naming each path and never to stage the whole
tree, so any file it forgot was simply absent from the commit. A new
`stageRunWork` stages the run's own work itself, and does it *before* the
uncommitted-work gate inspects the tree — order being the point. The gate's
job is to refuse a completion claim while finished work sits uncommitted, not
to punish an incomplete `git add`; staging first means it sees the run's work
as staged and the commit carries all of it, while anything that is **not**
the run's work stays dirty and is still refused.

Four exclusions keep that from meaning `git add -A`: anything already dirty
when the run started (the operator's work in progress, captured by the new
`captureBaselineDirty`), hench's own runtime artifacts including the
`.hench-commit-msg.txt` sentinel, and the PRD paths, which
`performCommitPromptIfNeeded` stages itself *after* writing the completion so
the status transition and the code land together. With no baseline captured
nothing is staged at all — an unknown baseline cannot tell the run's work from
the operator's, and guessing is how someone's work-in-progress ends up inside
a task commit.

**The mid-run auto-commit timer is off by default** (`hench.commitMsgTimeoutMs`
now defaults to `0`, was 300000). Armed, it fired five minutes after the agent
wrote its commit message — during the rest of the session and the whole review
pass — and committed whatever happened to be staged at that instant: before
the test gate, before the uncommitted-work gate, before the completion was
written, and without staging the PRD paths or the review repairs. It then set
`didAutoCommit()`, which short-circuits the real commit path, so the
completion write never reached a commit either and the next run's pre-run gate
inherited it. The case it covered — a run that dies after the agent staged its
work — is handled without committing anything unverified: the uncommitted-work
gate refuses to record the task done, and the next run's pre-run commit gate
offers the leftovers as a checkpoint. A positive value restores the timer.

That key was also described in three places as "how long the commit-message
generation call may run", which it never was. `ndx config`, `hench config` and
the dashboard's config form now say what it does.

No change was needed for per-iteration gating: `runIterations`, `runLoop` and
`runEpicByEpic` already call `shouldStopForUncommittedWork` between tasks, and
`between-task-uncommitted-guard.test.ts` already pins all three.
