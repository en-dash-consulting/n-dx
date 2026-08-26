---
"@n-dx/rex": patch
---

Every PRD tree slug is now id-qualified, and `rex migrate-slugs` renames existing trees in one pass.

`slugify()` emitted title-only slugs — the `-{id6}` suffix appeared only for long titles or same-tree sibling collisions. Same-titled items created on divergent branches therefore collided on identical paths, so a git merge silently unified two distinct items, and renaming an item relocated its files entirely. The suffix is now unconditional: every new write lands at `<title-slug>-<id6>`, making paths collision-free across branches (the title body is truncated to keep slugs within 40 characters, unchanged).

Existing trees keep working — the parser never depended on slug shape — but their next full save would rename everything as a side effect. `rex migrate-slugs` does that rename as one deliberate, reviewable pass instead: it snapshots the tree (undoable via `rex restore`), round-trips it through the store under the PRD lock, and reports how many entries were renamed. Idempotent — a second run is a no-op. The folder-tree schema doc's naming rules, examples, and collision-resistance notes are updated to match.
