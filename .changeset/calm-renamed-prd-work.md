---
"@n-dx/hench": patch
---

`n-dx work` preserves staged renames across PRD boundaries, including subsequent edits, when you accept an interactive failure rollback.

Rollback touches only the classified PRD paths offered by the prompt. The prompt describes restoration to HEAD and preservation of pre-existing untracked files. Noninteractive and autonomous runs continue to leave changes in place.
