---
"@n-dx/hench": patch
---

Add a pre-run commit gate to `hench run` / `ndx work`. Once per invocation (before the work loop begins, not per iteration), if the working tree has pre-existing uncommitted changes and the session is interactive, hench shows the diff stat plus an LLM-proposed commit message and prompts to **commit** (stage + commit with the standard N-DX trailers, then proceed), **stop** (abort before running), or **proceed** (start with changes left uncommitted). Clean trees and non-interactive/autonomous runs (`--auto`/`--loop`/`--epic-by-epic`/`--yes`) proceed without prompting so unattended loops are never blocked. This keeps a user's in-progress edits from being folded into hench's own commits.
