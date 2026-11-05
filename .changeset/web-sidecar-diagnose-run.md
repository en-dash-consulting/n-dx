---
"@n-dx/web": patch
---

Sidecar's Diagnose run lens now has a packet: the attached task's newest run, with the run classifier's verdict and ranked actions, the gate digest's end, the review's unrepaired findings and the last events. Each action is offered through the broker card that carries it out, and at attempt 2 of 2 the lens offers no re-run or `--fresh`. With no task attached the lens is unavailable and says it needs a task to diagnose.
