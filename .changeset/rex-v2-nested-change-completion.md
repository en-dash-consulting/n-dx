---
"@n-dx/rex": patch
---

On a v2 tree, a change that holds a nested change completes only when every live nested change and task is completed: `update_task_status` and `rex update --status=completed` refuse it while one is open and write nothing. Completing the last open nested change completes each `pending` enclosing change in the same write, and under `rex.applyOn: complete` applies them innermost first; a container is never applied while a nested change is unapplied. `ChangeCompletionResult` gains `applies` (every completed change's apply result). No MCP fields added.
