---
id: "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
type: "capability"
title: "Hench Process Concurrency Management"
slug: "hench-process-concurrency-management"
statement: "Hench limits and queues concurrent task execution and schedules runs against available system memory so that task execution does not exhaust system resources."
criteria: [{"id":"c1","text":"Hench shall limit the number of task executions that run at the same time."},{"id":"c2","text":"When a task execution request would exceed the concurrency limit, hench shall queue the request."},{"id":"c3","text":"While hench task execution is running, hench shall monitor system memory."},{"id":"c4","text":"Hench shall schedule task execution according to available system resources so that execution does not exhaust them."},{"id":"c5","text":"When the project opts in, hench shall admit at most one managed validation execution at a time per OS user on the host, across hench processes and worktrees, and shall record queue wait apart from execution time."},{"id":"c6","text":"When a test worker cap is configured, hench shall pass it to every test command it runs and to the agent session's shell."}]
source: "smart-add"
---

## History

- 2026-11-16 b772b0c5-c910-4e92-83bf-776a266c413a modified: Bound validation across worktrees: host-wide validation slot and test worker cap
