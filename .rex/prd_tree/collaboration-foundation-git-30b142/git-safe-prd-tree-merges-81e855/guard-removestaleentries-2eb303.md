---
id: "2eb30359-483f-4285-a2d5-fe657b4aba3a"
level: "task"
title: "Guard removeStaleEntries against stale snapshots"
status: "completed"
priority: "high"
startedAt: "2026-08-25T20:51:15.851Z"
completedAt: "2026-08-25T21:03:33.864Z"
endedAt: "2026-08-25T21:03:33.864Z"
acceptanceCriteria: []
description: "Any saveDocument deletes every on-disk item absent from the in-memory tree (removeStaleEntries in folder-tree-serializer.ts) - a save from a pre-merge or stale snapshot silently destroys items it never loaded, and the only recovery (.rex/.backups/) is gitignored and local. Add a staleness guard: verify the loaded snapshot is not older than the on-disk tree (mtime or content fingerprint) before allowing deletions, and require explicit prune intent for bulk deletes; fail loudly instead of deleting silently. PR boundary: serializer/store only. Acceptance criteria: (1) a stale-save fixture test errors instead of deleting; (2) the normal load-edit-save path is unchanged; (3) bulk deletion requires an explicit option; (4) the error message names the items that would have been deleted."
---
