---
"@n-dx/core": patch
"@n-dx/hench": patch
---

New `ndx work --task=<id> --require-unblocked` refuses to start the task, and exits non-zero, while any task it is blocked by is not completed. An explicit `--task` otherwise ignores blockers. `ndx work --plan-queue` lane commands now pass it on each blocked step, so a lane stops instead of running a task on top of a blocker whose run exited 0 without completing it. `ndx work --task=<id> --require-unblocked --resolve` reports the same refusal as `blocked`, naming each open blocker, and keeps the flag in its printed command.
