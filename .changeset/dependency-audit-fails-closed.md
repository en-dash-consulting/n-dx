---
"@n-dx/hench": patch
---

fix(hench): stop reporting a clean dependency audit for one that never ran

`runDependencyAudit` failed OPEN. Both of its steps guarded the parse on
`stdout` being non-empty, and a command that cannot be spawned comes back from
`exec` as exitCode 1 with empty stdout — so the parse was skipped, the all-zero
initializer was returned untouched, and the function answered `ran: true`. The
caller then printed `✓ No vulnerabilities or outdated packages found` for an
audit that had executed nothing. Two bare `catch {}` blocks discarded any throw
on the way. This was the reverse of the direction a security-adjacent check
should fail, and worse than being loudly wrong: it was silently reassuring.

Each step is now classified, and every way of failing to produce counts is
reported as `ran: false` with a reason: never launched (naming the spawn error),
killed on timeout, a non-zero exit with no output (carrying the stderr tail, so
`ERR_PNPM_NO_LOCKFILE` reaches the operator), unparseable JSON, and a payload
that parses but carries no vulnerability data — pnpm reports its own errors as
JSON too. `exitCode 0` with no output stays a real empty report, because
`pnpm outdated --json` prints nothing when every dependency is current.

`DependencyAuditResult` now has a three-outcome contract — ran, partial, and
inconclusive — with per-step `commands.audit` / `commands.outdated` records
saying which half failed and why. **An inconclusive audit warns and proceeds**,
and the reasoning is recorded on the type: the audit gates nothing today (a run
with ten critical vulnerabilities proceeds), so a `pnpm` that will not spawn must
not be a harder stop than the vulnerabilities themselves; the defect being fixed
is the false clean bill of health, not the decision to continue. A future gate
that wants to fail closed can already distinguish the state.

The dead `hasIssues` computation is gone. It was this defect in miniature —
OR-ing over counts a never-launched step had left at zero — and nothing read it.
