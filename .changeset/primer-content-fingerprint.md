---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/hench": patch
---

Stamp the primer with a content fingerprint, so an analysis that changed nothing
stops invalidating it.

`.sourcevision/PRIMER.md` is the distilled startup context `ndx work` feeds every
task. It was stamped with a hash of `analyzedAt` and `gitSha` — but every
`sourcevision analyze` rewrites `analyzedAt`, so the stamp went stale on *every*
run. A run that makes no LLM call (no vendor reachable, a CI runner, `ndx ci`, a
provider outage) cannot re-distil and cannot re-stamp, so from that point on both
readers rejected a primer that was still perfectly accurate: `ndx work` silently
fell back to the full CONTEXT.md and orientation re-explored from scratch. Two
cheaper losses came with it — an LLM-enabled analyse never hit the primer cache,
so it bought a `context.distill` call on every run, and hench's warm-parent
session cache, keyed on the same value, was thrown away by every re-analysis of
an unchanged tree.

`sourcevision analyze` now computes `analysisFingerprint` from `gitSha` and the
CONTEXT.md it just wrote — the primer's actual input, with no timestamp in it —
and publishes it in `manifest.json`. Two analyses that found the same thing
produce the same value; a changed tree produces a different one and the primer is
correctly rejected until re-distilled.

Consumers now *read* that field rather than recomputing the hash, which also
retires two of the three copies the cross-tier contract test existed to police.
A manifest written before the field falls back to the old `analyzedAt + gitSha`
hash, so an existing manifest and the primer beside it keep matching until the
next analysis re-stamps both.
