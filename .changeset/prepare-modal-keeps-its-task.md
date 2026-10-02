---
"@n-dx/web": patch
---

Keep an open Prepare task modal on the task it was opened for. When the host's next task changed while the modal was open (the Up Next and Live idle cards poll), the modal kept the first task's edits and preview but posted the new task's id on Execute. The Start button now captures the task at open, and the modal is keyed by task id.
