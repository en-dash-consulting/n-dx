---
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/core": patch
---

On a v2 tree, `n-dx work` names runnable changes as changes and tasks as tasks.

Hench prints "Change: <title> (runs as one task)" for a task-less change and "Task: <title> (in change <title>)" for a task. The adversarial reviewer says a capture lands as an Inbox change. `n-dx work` help says `--task` takes a task or a change that runs as one task and lists `--mine` and `--tags`; `rex next` help says task or change, and its empty-tree hint on v2 is `rex add --title=...`. A v1 tree keeps its words.
