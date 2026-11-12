---
"@n-dx/web": patch
---

The `dashboard` withholds run controls and refuses settings or launches for held Inbox work, closed changes, containers and v2 subtasks.

Action needed: Place held work from the Inbox, reopen closed changes when appropriate, and start or configure a subtask through its parent task.

Empty-product Inbox work, placed task-less changes, explicit deferred tasks and v1 tasks/subtasks retain their execution behavior. Saved model pins and transactional version checks remain intact.
