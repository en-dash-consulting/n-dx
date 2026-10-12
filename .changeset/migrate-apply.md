---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate --apply` (`rex migrate --apply [--plan=<path>]`) applies a reviewed v1 → v2 migration plan. It writes `product/` and `changes/` and removes `prd_tree/` and `tree-meta.json` under one hold of the PRD lock, so the two layouts never sit side by side. Every v1 id is checked by count and id before anything is written and again on the tree read back. Changes the rules placed land on their capability; held changes, and items made after the plan, land in the Inbox, with any model pick recorded as a suggestion only. Release and review epics become no node, and a `blockedBy` ref to one is repointed at the changes it split into. The first change, "Product map and change layer", records the cut. Apply refuses a plan whose model pass stopped, and refuses while `.rex/prd.md`, `.rex/prd.json` or a branch-scoped PRD file sits beside the tree. On a v2 tree it reports so and exits zero.

`--dry-run` runs apply's checks, including the staged write and read-back, and prints per v1 kind how many items become each v2 type, how many are held for the Inbox and how many metadata values are dropped (`droppedMeta`, `droppedLog`); it writes nothing in the project.

v2 trees store Inbox changes in the reserved `changes/inbox/` folder: a change added with no target lands in `changes/inbox/<slug>/` with `needsPlacement: true`, and placing it moves it to `changes/` with its id and slug kept. Trees that keep Inbox changes at the `changes/` root still read, and the next write moves them in. No top-level change may take the slug `inbox`.

The v2 writer refuses to turn a folder into a leaf while its `state.yaml` holds top-level keys other than `schema` and `items`, naming the folder and the keys, instead of dropping them. `rex migrate-to-folder-tree` renames a converted `prd.json` to `prd.json.migrated`.
