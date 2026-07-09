---
"@n-dx/hench": patch
---

Add a pre-run commit gate to `hench run` / `ndx work`. Once per invocation (before the work loop begins, not per iteration), if the working tree has pre-existing uncommitted changes and the session is interactive, hench shows the diff stat plus an LLM-proposed commit message and prompts to **commit** (stage + commit with the standard N-DX trailers, then proceed), **stop** (abort before running), or **proceed** (start with changes left uncommitted). This keeps a user's in-progress edits from being folded into hench's own commits.

Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) can't prompt without stalling an unattended loop, so a dirty working tree makes them **abort by default** rather than silently absorb the pre-existing changes. Pass the new `--allow-dirty` flag to start an autonomous run against a dirty tree anyway. Clean trees, `--yes` runs, and other non-interactive sessions proceed without prompting as before.
