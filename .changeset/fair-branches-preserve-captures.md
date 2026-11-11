---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Hold the shared PRD write lock through branch-start assignment, commit and recovery. Restore only verified assignment files after a failed commit, preserving concurrent captures and retaining a recovery branch when ownership conflicts or Git recovery fails.
