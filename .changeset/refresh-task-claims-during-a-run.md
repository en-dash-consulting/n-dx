---
"@n-dx/hench": patch
---

Refresh a run's task claims for as long as the run lasts.

A cross-worktree claim carries a four-hour expiry as well as a pid, and both
have to fail before it is ignored. The pid covers the common death — crash,
kill, reboot — and recovers in seconds. The expiry covers what the pid cannot
see: a process that is alive but no longer working the task, and any claim
written on another machine, where `kill(pid, 0)` means nothing.

Nothing refreshed that expiry, so a run longer than the TTL let its own claim
lapse while it was still working, and the next worktree to select walked
straight onto the task — the double-pick claims exist to prevent. Runs that
long are ordinary: an `--epic-by-epic` pass over a large epic outlives four
hours comfortably.

`TaskClaims` now refreshes what it holds on a self-rescheduling timer, started
beside the claims instance in `hench run` and stopped by `releaseAll`. The
timer aims at half the time left on the claim that lapses soonest, read from
the claim the store actually wrote rather than from a TTL constant in hench,
so the two cannot drift apart; it is clamped to a 30-second floor and a
15-minute ceiling, and it is `unref`ed, so renewal never keeps the process
alive on its own.

A refusal during renewal means the claim lapsed and another worktree took the
task over. The run continues — abandoning work in progress is worse than the
overlap, and the other worktree is already on it — but the task is dropped
from what this run considers held, so it can no longer release a claim that
belongs to someone else.
