---
"@n-dx/web": patch
"@n-dx/rex": patch
---

Closing a feature's last task from the dashboard now completes the feature, and its epic when that was the epic's last open work, as `rex update` and the MCP `update_task_status` tool already did. The dashboard's status and bulk-status routes used to save only the task. Its feature stayed pending with every child done, so `ndx loop` selected the empty feature as the next task and handed the agent a run with nothing to do. The parent cascade is now one rex function, `cascadeParentCompletion`, shared by all three writers.
