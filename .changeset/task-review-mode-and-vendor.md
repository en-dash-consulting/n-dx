---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

The run block gains reviewMode and reviewVendor; add_item and edit_item accept them. A task can now be pair-reviewed by a chosen vendor whatever the project default is. `ndx work` takes `--review-mode=<off|self|pair>` and `--reviewer=<claude|codex>`, and applies them as flag, then the task's `run`, then `hench.review.*`, then the default. A saved value the run cannot honour (a reviewer equal to the executor, or pair on an executor with no CLI counterpart) is skipped with a warning and never stops a loop. `ndx work --resolve` reports `reviewMode` and `reviewVendor` under `resolved`, each with its source, and `review` now holds only `rounds`.
