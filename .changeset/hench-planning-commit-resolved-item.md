---
"@n-dx/hench": patch
---

The pre-run planning commit's `N-DX-Item` trailer now names the canonical id of the task `--task` runs. On a v2 PRD, `--task` given as a display id (`CH-12`), an alias or a change id is resolved to that change's task first. A ref that resolves to no item leaves the trailer out instead of writing it as typed.
