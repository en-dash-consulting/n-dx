---
"@n-dx/hench": patch
---

Fix the full-suite gate skipping runs that changed files — including every run
the adversarial review pass had just repaired.

The gate read `filesChanged` from the model's own summary of what it had done,
with a git fallback that only fired when the loop recorded no tool calls at
all. The Claude CLI always records tool calls, so on the default path the
fallback never ran and an empty summary meant the gate skipped, reporting "no
files modified" for runs that had modified files. Review-pass repairs could
not be seen either way: they happen in a separate spawn, after the summary is
parsed.

Changed files are now derived from git, against the commit the run started
from rather than HEAD. That baseline matters: on the autoCommit path the
executor commits its own work before the gate runs, so a HEAD-relative diff
reports nothing and the gate would skip the very run it should test. The
pre-run baseline sees committed work and still-uncommitted reviewer repairs
alike, plus newly untracked files, excluding untracked paths that were already
present when the run started (those are the user's, not the run's).

Discovery returns "git could not answer" distinctly from "nothing changed", so
a repo without git leaves the previous model-reported list in place instead of
being overridden by a guess. Untracked files are enumerated with
`--untracked-files=all` so a new directory yields its individual files: the
gate aggregates per file path, and a bare `src/` names no file and maps to no
package.
