---
"@n-dx/web": patch
---

Commands-reference rows now match what their Run buttons actually do: the plan row is read-only (its trigger ran only the rex step, not the full plan pipeline), refresh's description states the trigger uses --data-only, ci gains a Run trigger with status polling, and analyze no longer declares a status endpoint its synchronous quick run never uses. rex fix/reshape remain deliberately Validation-view actions.
