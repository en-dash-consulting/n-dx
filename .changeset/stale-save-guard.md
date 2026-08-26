---
"@n-dx/rex": patch
---

Saving a stale PRD snapshot now fails loudly instead of silently deleting another writer's items.

Every save of the PRD folder tree removes on-disk items absent from the document being saved — a full-replacement contract that made a save from a pre-merge or stale snapshot silently destroy items it never loaded, with only the gitignored local `.rex/.backups/` for recovery.

The serializer now collects deletions instead of applying them mid-walk, and guards them before deleting anything: a deletion candidate whose on-disk state is newer than the document's load time (recursively — a fresh child inside an old folder counts) aborts the entire save with an error naming each item that would have been destroyed, its id, and its path. Both stores stamp the load time on every `loadDocument` and refresh it after their own successful saves, so normal load-edit-save flows and same-writer sequential saves are unchanged while a genuinely stale snapshot is refused. A save that never loaded the tree may not delete at all; a deliberate whole-tree rewrite (migration, restore) states its intent with the serializer's explicit `allowBulkDelete` option.
