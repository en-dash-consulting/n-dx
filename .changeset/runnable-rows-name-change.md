---
"@n-dx/web": patch
"@n-dx/hench": patch
---

Run controls say "Start" and the Live view "Live run". On a v2 tree, Live's running and Up next rows, the Sidecar work card and the run-plan card's track rows read "<task> · in <change>", or "<change> · runs as one task" for a change with no tasks. The queue plan JSON gains an additive `changeTitle` per lane.
