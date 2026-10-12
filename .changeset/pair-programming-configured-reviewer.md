---
"@n-dx/core": patch
---

`ndx pair-programming` now reviews with the configured reviewer. It takes the
vendor from `hench.review.vendor` (an invalid or primary-vendor value warns and
keeps the default), passes `llm.<reviewer>.reviewModel` then `llm.reviewModel`
to the reviewer CLI as `--model`, and runs up to `hench.review.rounds` (default
2) review and remediation cycles instead of one. Each round prints the reviewer
and model it used.
