---
id: "f7e6bab2-0bc4-45fc-8743-edcee40b2f2b"
type: "capability"
title: "Hench Process Concurrency Management"
slug: "hench-process-concurrency-management"
statement: "Hench limits and queues concurrent task execution and schedules runs against available system memory so that task execution does not exhaust system resources."
criteria: [{"id":"c1","text":"Hench shall limit the number of task executions that run at the same time."},{"id":"c2","text":"When a task execution request would exceed the concurrency limit, hench shall queue the request."},{"id":"c3","text":"While hench task execution is running, hench shall monitor system memory."},{"id":"c4","text":"Hench shall schedule task execution according to available system resources so that execution does not exhaust them."}]
source: "smart-add"
---
