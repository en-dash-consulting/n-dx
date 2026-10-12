---
"@n-dx/hench": patch
---

Stop a usage mark taken inside another mark's window from double-counting the overlap.

`/ndx-work` marks a task and records it at the end; an `/ndx-adversarial-review`
run inside that window marks and records too. The inner record was consumed
first, so the task's window still contained it and claimed those tokens a second
time — `ndx usage` and `get_token_usage` both over-reported.

Every record now charges the span it claimed to the marks still outstanding that
enclose it, and a mark's window is read less whatever was charged to it. The
nested records sum to the outer window instead of overlapping, and the task keeps
its own work from before and after the inner one.
