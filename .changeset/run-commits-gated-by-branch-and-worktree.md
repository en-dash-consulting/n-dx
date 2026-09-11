---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Bind hench's automatic commits to the checkout the run started in. Run records
now carry `worktreeRoot`, `branch` and `startHead`, captured at run start, and
each of the four automatic commit sites (pre-run gate, completion metadata,
commit-message watcher, review repairs) re-checks them before committing. A run
whose HEAD has been moved to another branch, detached, or whose worktree root no
longer matches refuses to commit and reports the expected and actual values,
leaving the working tree untouched.

`getCurrentHead` and `getCurrentBranch` now capture git's stderr instead of
inheriting it, matching their `rev-parse` siblings: probing a directory that may
not be a repository no longer prints `fatal: not a git repository` to the
terminal.
