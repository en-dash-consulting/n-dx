---
id: "2eb30359-483f-4285-a2d5-fe657b4aba3a"
type: "change"
title: "Guard removeStaleEntries against stale snapshots"
slug: "guard-removestaleentries-against-stale"
intent: "Any saveDocument deletes every on-disk item absent from the in-memory tree (removeStaleEntries in folder-tree-serializer.ts) - a save from a pre-merge or stale snapshot silently destroys items it never loaded, and the only recovery (.rex/.backups/) is gitignored and local. Add a staleness guard: verify the loaded snapshot is not older than the on-disk tree (mtime or content fingerprint) before allowing deletions, and require explicit prune intent for bulk deletes; fail loudly instead of deleting silently. PR boundary: serializer/store only. Acceptance criteria: (1) a stale-save fixture test errors instead of deleting; (2) the normal load-edit-save path is unchanged; (3) bulk deletion requires an explicit option; (4) the error message names the items that would have been deleted."
touches:
  - "81e855bf-c278-46b7-924f-d5a3c4227b22"
priority: "high"
---
