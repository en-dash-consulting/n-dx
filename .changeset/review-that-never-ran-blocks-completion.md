---
"@n-dx/hench": patch
"@n-dx/core": patch
---

A review pass that could not run no longer reports a completed, reviewed task

`ndx work --review` is a gate, but a reviewer whose spawn failed (a stale vendor
CLI, a `--review-model` the installed binary rejects) left a run that reported
`completed`, committed, and said nothing — indistinguishable from a reviewer that
read the diff and found nothing.

A reviewer that never started now refuses the completion: the run fails naming the
missing review, the task returns to `pending` (not deferred), the validated work is
left in the tree rather than rolled back, and the run does not count toward
stuck-task detection, because the usual cause is a config line rather than a defect
in the task. `--review-optional` downgrades the refusal to a warning.

A reviewer that *did* run and only lost its report still warns, as before. Both the
end-of-run summary and `hench show` now carry a review line, so a run that was never
reviewed says so where the terminal output does not survive.
