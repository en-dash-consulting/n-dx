---
"@n-dx/hench": patch
---

On a v2 tree, hench completes a task through rex's v2 runtime (`completeV2Work`), as `update_task_status` does: completing a change's last task completes the change and applies its amendments per `rex.applyOn`. Before, hench's v1 ancestor cascade completed the change without applying it.
