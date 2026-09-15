---
"@n-dx/hench": patch
---

fix(hench): API-provider loops validate completion like the CLI loop

The local (LM Studio), Google, and Claude API loops treated "the model stopped
calling tools" as completion: the run was recorded as completed, the task was
marked done in the PRD, and completion metadata was committed — even when the
model changed nothing at all. The CLI vendors (claude, codex) have always run
`validateCompletion` first and rejected such runs. A qwen run that made one
status-update tool call and quit was therefore "completed" under vendor=local
when the identical behaviour under vendor=claude would have failed with
"Completion rejected".

All three API loops now apply the same post-loop gate the CLI loop applies in
`processSuccessfulResult`: a completion claim with no meaningful changes fails
the run and resets the task to pending (`completion_rejected`) so the next
cycle retries it.

`validateCompletion` itself now shares the test gate's change discovery
(`discoverChangedFiles`, moved to `validation/changed-files.ts` to respect the
zone boundary) instead of a raw `git diff --stat`. Two defects fall out of the
old diff:

- `.rex/`/`.hench/` bookkeeping counted as changes — hench dirties the task's
  PRD file on every run, so a do-nothing run still validated as "has changes".
- Untracked files never appear in a diff, so a purely-additive task (new module
  + new test, nothing committed) was rejected as "no changes detected".

Both loops now pass `baselineUntracked` through, so a user's pre-existing
untracked files are not attributed to the run.
