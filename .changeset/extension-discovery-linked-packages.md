---
"@n-dx/core": patch
---

Extension discovery now notices an edit to a linked extension's `package.json` (a `file:`, `link:` or workspace dependency, or `ndx extensions add <folder>`), so a changed version or manifest asks for approval again instead of running the stale one.
