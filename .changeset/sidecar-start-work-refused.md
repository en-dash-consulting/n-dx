---
"@n-dx/web": patch
---

The Sidecar's `start_work` waits out a run's starting phase: a start hench refuses (dirty tree, missing task) comes back as failed with hench's message instead of "Started run", and a run that fails later revises its card to failed, so a run-plan lane reads open again.
