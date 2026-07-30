---
"@n-dx/hench": patch
---

Make the `rollbackOnFailure` revert **prompt-only** — a failed run never discards work without an express, per-run confirmation. On an interactive TTY, a failed run prompts `Revert N uncommitted file(s)? [y/N]` (defaults to **No**); only an explicit yes reverts — and even then the revert stays scoped (#303): tracked changes are reverted via `git reset`/`checkout`, but untracked removal is limited to files the agent created this run (diffed against the pre-run baseline); pre-existing untracked work is never deleted. Declining preserves the working tree.

Non-interactive runs — autonomous (`--auto`/`--loop`/`--epic-by-epic`), `--yes`, and non-TTY/CI — have no channel for a per-run confirmation, so they **never** revert on failure: the working tree is left exactly as-is and the uncommitted files are reported. This replaces the previous unattended auto-revert. `--no-rollback` / `hench.rollbackOnFailure: false` still suppresses the prompt entirely. PRD status reset on failure is unchanged.
