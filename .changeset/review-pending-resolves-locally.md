---
"@n-dx/hench": patch
---

`hench review pending <run>` finds its report after the project has moved on
disk.

It preferred the absolute `reportPath` stored on the run record, on the
reasoning that a stored path protects a moved project. It does the opposite: a
move is precisely when that path is stale, so the command failed with "Could
not read the review report" for a report sitting in the project's own
`.hench/reviews/` under its run id. Reports are keyed by run id in a fixed
subdirectory, so the canonical location is derivable wherever the project now
lives; it is tried first, and the recorded path is kept as a fallback for a
report that is genuinely somewhere else.
