---
"@n-dx/web": patch
---

The dashboard git panel's **Commit PRD update** commits hundreds of files at once, instead of failing with "git add failed: unknown error" on Windows.

The scoped commit passed every path to git as an argument, which overran Windows' command-line limit after a large batch of PRD changes, so git never started. Paths now go to git on standard input. A git failure that prints nothing now shows the underlying error instead of "unknown error".
