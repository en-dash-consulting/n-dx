---
"hench": patch
---

Gate the `rollbackOnFailure` revert behind an express prompt in interactive runs, and never delete untracked files without confirmation. On a failed run with `rollbackOnFailure` enabled, an interactive TTY session now prompts `Revert N uncommitted file(s)? [y/N]` and **defaults to No** — a stray Enter preserves the working tree. Declining leaves everything untouched.

Autonomous (`--auto`/`--loop`/`--epic-by-epic`), `--yes`, and non-TTY runs still auto-revert without prompting (no stdin hang), but a silent auto-revert now discards only **tracked** changes: `git clean -fd` (untracked-file removal) runs only after an express confirmation. `revertChanges` gains a `cleanUntracked` option (default `true`) to support this. `--no-rollback` / `hench.rollbackOnFailure: false` still disables the revert entirely.
