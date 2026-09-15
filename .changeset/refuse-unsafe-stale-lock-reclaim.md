---
"@n-dx/rex": patch
---

Stop automatically deleting stale PRD lock files because a concurrent writer can replace the inspected lock before path-based cleanup runs. Crashed-writer locks now fail loudly with the existing manual-cleanup guidance.
