---
"@n-dx/hench": patch
---

Implement the batch session strategy, so `hench.sessionStrategy: "batch"` does
what it already claimed to.

That value was documented, accepted by config, and returned by strategy
resolution — but the run loop only acted on `"fork"`, so setting it silently
produced cold spawns.

Batching resumes the *previous task's* session rather than forking a fixed
orientation, so the transcript accumulates. That is not a lesser fallback: it
is the correct shape for a CLI whose resume appends rather than branches, which
is exactly what `codex exec resume` does — it has no `--fork-session`
equivalent. It also makes `hench.tasksPerSession` load-bearing rather than
cosmetic, since an unbounded shared transcript costs more on every later turn
and lets one task's framing bleed into the next.

The chain lives in the session cache beside the orientation parent, because
the run loop executes once per task and the chain has to survive between
calls. Writes merge rather than replace, so neither strategy discards the
other's state, and `--fresh` no longer clears a batch chain — re-orienting is
not the same as forgetting everything. A chain advances only after a
*completed* task: a failed task's transcript now contains the failure, and
resuming it would start the next task inside it.

Briefs after the first are prefixed with an emphatic task-boundary divider —
naming the previous task finished, forbidding its plan from being resumed,
demoting earlier turns to background, and telling the model to re-read files
because the working tree has moved. Cross-task pollution is batching's known
cost, and a subtle marker would not have addressed it.

Verified against the live Claude CLI: three chained tasks all reported the same
session id (appended, not branched), the second recalled a fact planted in the
first, and the third could count the earlier tasks. The codex leg is captured
as a follow-up rather than shipped unverified — that adapter has no session
handling yet, and its session-id event shape could not be confirmed here.
