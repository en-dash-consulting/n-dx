---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Stop the run log's `.gitignore` write leaving the tree dirty

`.run-logs/` needs a `.gitignore` entry, and hench appended it inside
`persistRunLog` — which finalize calls *after* the commit step. The append is
idempotent, so it happened exactly once per project and left exactly one
modified tracked file behind, with nothing left in the run to commit it.

Two people paid for that one write: the edit rode the *next* run's
`git add -A` into a "commit local changes before hench run" commit attributed
to unrelated work, and an autonomous run (`--auto`/`--loop`/`--epic-by-epic`)
that aborts on a dirty tree could be blocked by hench's own housekeeping.

- `ndx init` now writes the entry alongside `.n-dx.local.json`, where the
  project's other ignore rules are set. It is project setup, not run output.
- hench claims the entry at run **start** instead, as the fallback for projects
  initialised before that. The entry lands in front of the executor's
  `git add -A`, so the run that needs it is the run that commits it.
- `persistRunLog` no longer touches `.gitignore` at all.
