---
"@n-dx/hench": patch
---

`n-dx work` removes newly emptied PRD folders after a confirmed rollback, preserving folders that existed before the run, including empty ones.

The pre-run directory scan is limited to PRD trees and their ancestors. Ignored and unrelated subtrees remain unread and their directories are conservatively preserved during rollback.
