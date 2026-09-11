---
"@n-dx/rex": patch
---

feat(rex): `rex status` (and `ndx status`) shows the last work cycle

The status tree now ends with a "Last work cycle" section: which tasks the
most recent `ndx work` / `--auto` / `--loop` invocation completed, failed
(labelled with timeout / budget exceeded / transient error where that is the
reason), and skipped (cancelled), plus a counts line. Previously the operator
had to dig through `.hench/runs/` JSON or `.run-logs/` to reconstruct what
the last cycle actually did.

The section is derived from the run records hench already persists under
`.hench/runs/` — read as data files, following the precedent in
`core/token-usage.ts` — so history survives across sessions with no new
state. Records carry no batch id, so a cycle is reconstructed from timing:
runs cluster while the gap from one run's finish to the next run's start
stays within 30 minutes (loop pauses are seconds; separate invocations are
usually hours apart).

Human tree view only — the JSON, `--quiet`, `--tree`, and `--group-by`
output contracts are unchanged, and a project with no run history shows no
section at all.
