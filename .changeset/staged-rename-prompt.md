---
"@n-dx/hench": patch
---

`n-dx work` limits its PRD rollback prompt's rename protection promise to staged cross-boundary renames and explicitly excludes unstaged moves made with plain `mv`.

Message text only; rollback behavior is unchanged.
