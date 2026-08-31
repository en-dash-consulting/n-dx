---
"@n-dx/hench": patch
---

Stop calling a failed non-must-fix capture an unrepaired must-fix.

`unresolvedFindings` returns two different things: must-fix findings the pass
could not repair, and findings of any verdict whose action failed. The review
warning reported the combined count as "N must-fix finding(s) were not
repaired", so run 4b4526c5 — whose single unresolved finding was a low/should-fix
whose PRD capture failed — warned of an unrepaired must-fix. Counting failures
toward alarm is deliberate; labelling them all must-fix overstates the severity,
and a warning that cries wolf stops being read.

`classifyUnresolved` now partitions the two, and a failed must-fix lands in the
must-fix bucket only, so the buckets never double-count. `formatUnresolvedWarning`
emits one line per reason, and is a pure function beside `formatReviewSummary`
rather than an inline string in the run loop — the wording was previously
untested, which is how the mislabel shipped.

`run.review` gains `unrepairedMustFixCount` and `failedActionCount`.
`unresolvedCount` keeps its meaning as the combined headline, with its doc
comment corrected: it had claimed to be a must-fix count.
