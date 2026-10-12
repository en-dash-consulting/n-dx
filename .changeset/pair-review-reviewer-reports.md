---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

`hench.review.mode: "pair"` now reviews. After a task validates, the other
vendor's CLI starts a fresh session, reads the task, the changed files and the
diff, edits nothing, and writes the findings report. The review runs on
`llm.<reviewer>.reviewModel`, then `llm.reviewModel`, then the vendor default,
and the run record carries `mode: "pair"`, the reviewer vendor and model. Until
the fix loop lands, every finding, must-fix included, is captured or queued and
the commit is not blocked. A reviewer CLI that is missing or signed out skips
the review with a warning under `--review-optional`, as before.
