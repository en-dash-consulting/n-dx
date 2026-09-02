---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Add the warm-parent session foundation: `--fork-session` support, the
orientation session cache, and the session-strategy config keys.

The Claude CLI adapter gains `forkSession`, emitting `--fork-session` after
`--resume` so a spawn can inherit a parent transcript under a new session id
without mutating the parent. Forking without a session to fork from is
suppressed rather than passed through — it would claim a fork that never
happened.

A new `agent/lifecycle/session-cache.ts` owns which orientation session
exists and whether it is still safe to fork. Finding a parent is permissive
(absent, unreadable, or corrupt cache files are all simply a miss, costing one
orientation spawn); *using* one is strict, because a stale hit would have
every task in a loop inherit an orientation describing a repo that has since
changed. A parent is rejected, with a named reason, when the sourcevision
analysis fingerprint changes, when it ages past `hench.parentMaxAgeHours`,
when the vendor or model differs from the one it was built under, or when
`--fresh` is requested.

New config: `hench.sessionStrategy` (`fork` | `batch` | `cold`),
`hench.tasksPerSession` (default 4), and `hench.parentMaxAgeHours` (default
24), documented in `ndx config --help`. Strategy resolution degrades rather
than errors: forking needs a CLI that resumes by session id, so other vendors
and `provider=api` resolve to `cold`.

No spawn behavior changes yet — the orientation pass and fork wiring that
consume this land next.
