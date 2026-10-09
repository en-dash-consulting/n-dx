---
"@n-dx/rex": patch
"@n-dx/core": patch
---

New `rex product show|edit` and `rex change place|apply` for a v2 PRD. On a v2 tree `rex add` (and `ndx add`) creates a change, or a task or subtask under `--parent`, and prints it with its suggested placement; a description becomes one change. `--criterion` stays a work item's acceptance criteria; a capability's capability criteria use `--capability-criterion`. v1 trees behave as before.
