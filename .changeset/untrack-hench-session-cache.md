---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Stop the pre-run git gate counting the warm-parent session cache as operator work.

`.hench/session-cache.json` is rewritten on every orientation, but it was absent from `HENCH_RUNTIME_GITIGNORE_ENTRIES` and from both ignore lists, so `git add -A` in the pre-run commit gate swept it into commits — and a later run then saw its own write as one uncommitted file and refused to start. It is now ignored, discounted by the gate, and written by `hench init`. The ignore template test additionally pins every declared runtime artifact to both ignore files, so the constant can no longer drift away from them.
