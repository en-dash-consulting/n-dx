---
"@n-dx/hench": patch
---

`ndx work --task=<change> --reset-deferred --resolve` reads the change's tasks as the reset would leave them (the operator's own under `--mine`), so a change whose only open task is deferred reports that task instead of a not-actionable refusal: the preview now matches the run.
