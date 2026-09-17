---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

`SelectionExplanation` now carries a machine-readable `reason` (`in_progress` | `ready_to_finalize` | `priority`) alongside its rendered `summary`. Hench's task header branches on that code instead of substring-matching rex's prose, so rewording the summary no longer silently degrades a finalize-ready parent's label to "medium priority".
