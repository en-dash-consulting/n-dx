---
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

Escalate a task that keeps failing to a stronger vendor or model before it is
skipped as stuck. New settings, off by default: `hench.escalation.enabled`
(false), `hench.escalation.after` (2 consecutive failures), `hench.escalation.vendor`,
an optional `hench.escalation.model`, and `hench.escalation.maxAttempts` (1).
When a task reaches `after` failures (or `hench.maxFailedAttempts`, if lower),
its next attempt runs on the escalation vendor and model through the per-task
settings resolution, on that vendor's CLI when it has one; an explicit
`--model` flag and a task's saved `run` block keep their precedence. Hench
logs one line per escalated attempt, records `escalation` on the run record,
and `ndx work --resolve` reports it. Only when the escalated attempts also
fail is the task skipped as stuck. `ndx config`, `hench config` and the
dashboard offer the new keys.

Stuck and forced-advancement exclusions now also apply when selecting from a
v1 PRD, where they had stopped taking effect.
