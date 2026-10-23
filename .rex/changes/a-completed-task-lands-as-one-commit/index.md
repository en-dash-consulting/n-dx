---
id: "126831f0-baca-42f2-9a9a-040660527f4e"
type: "change"
title: "A completed task lands as one commit: work, then its completion"
slug: "a-completed-task-lands-as-one-commit"
intent: "hench committed a task's work and its completed status separately. The agent commits during its session, before hench's gates mark the task, so the completion followed in a chore(prd) record commit; and even when the commit prompt staged the status with the code, hench then wrote the commit's SHA onto the PRD item, which can only land after the commit, so every completed run ended in a trailing chore(prd) commit. Fix: drop the post-commit SHA write (commits are tied to items by the N-DX-Item trailer), and fold the completion into the run's last commit when the agent already committed, guarded so the amend never reaches a published, merge, or other item's commit."
acceptanceCriteria:
  - "A run whose commit prompt commits the work leaves no PRD change and no follow-up commit behind"
  - "A run whose agent committed for itself (autoCommit on or off) ends with the completion in that commit, with N-DX-Status and N-DX-Item trailers, and no chore(prd) commit"
  - "The fold never amends a commit that is on a remote, is a merge, names another item, predates the run, or is made during a git operation; those fall back to a separate record commit with the reason printed"
  - "Work the operator staged stays staged and out of the folded commit"
  - "A gate-only retry folds the completion into the earlier attempt's work commit"
touches:
  - "03266251-06ef-4864-960a-0cb02986ff1d"
priority: "high"
source: "ndx-capture"
---
