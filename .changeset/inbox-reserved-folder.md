---
"@n-dx/rex": patch
---

The Inbox is a reserved folder in a v2 tree, not a flag at the change-layer root. An unplaced change is written to `changes/inbox/<slug>/index.md` with `needsPlacement: true` in that folder's own `state.yaml`, and placement moves it out to the change-layer root keeping its id and its slug. The reader reads `changes/inbox/` as a folder rather than a change, so its children are top-level changes and every count, selection and bundle sees the tree as before. A tree written by the earlier layout, with the flag on a change at the changes root, still reads and moves into the folder on the next write.
