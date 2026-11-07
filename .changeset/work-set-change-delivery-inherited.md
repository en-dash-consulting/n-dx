---
"@n-dx/rex": patch
---

A change's own `delivery.branch` covers its open tasks that have none, so a task-less change assigned to a branch keeps the tasks it is later split into in that branch's work set; a task's own `delivery` overrides it. `rex branch add` refuses such a task for another branch without `--move`, naming the change; `rex branch remove <change>` takes the inherited tasks off; `rex branch remove <task>` on a task that only inherits writes nothing and names the change.
