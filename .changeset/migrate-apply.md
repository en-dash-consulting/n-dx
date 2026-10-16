---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate --apply [--plan=<path>] [--dry-run]` (`rex migrate-apply --plan=<path.json>`) applies a reviewed `ndx migrate --plan` plan, reading `./migration-plan.json` by default, where `ndx migrate --plan` writes. It writes `product/` and `changes/` and removes `prd_tree/` and `tree-meta.json` under one hold of the PRD lock, so the two layouts never sit side by side. Every v1 id is checked by count and id before anything is written and again on the tree read back. Changes the rules placed land on their capability; held changes, and items made after the plan, land in the Inbox, with any model pick recorded as a suggestion only. Release epics become no node, and a `blockedBy` ref to one is repointed at the changes it split into. A `blockedBy` ref to a capability, constraint or area names that node's open changes, a product node's own `blockedBy` moves onto its open changes, and a ref with no open change to name is dropped as met; the cut change lists every rewrite and drop. The first change, "Product map and change layer", records the cut. Apply refuses a plan whose model pass stopped, and refuses while `.rex/prd.md`, `.rex/prd.json` or a branch-scoped PRD file sits beside the tree. On a v2 tree it reports so and exits zero. A `prd_tree/` left beside the v2 tree is removed only when it is what an interrupted apply left (it matches the plan's source or, with no plan, every id it holds is in the v2 tree); any other is refused and kept, naming the ids to re-capture, and `--dry-run` says which.

`--dry-run` runs apply's checks, including the staged write and read-back, and prints per v1 kind how many items become each v2 type, how many are held for the Inbox and how many metadata values are dropped (`droppedMeta`, `droppedLog`), and each `blockedBy` rewrite and drop with its old and new refs; it writes nothing in the project.

Soft freeze: `rex migrate-apply` is a new rex command and `--apply`, `--plan=<path>` and `--dry-run` are new `ndx migrate` flags; the `--plan` and `--out` behaviour of `ndx migrate --plan` and `rex migrate-plan` is unchanged.

The v2 writer refuses to turn a folder into a leaf while its `state.yaml` holds top-level keys other than `schema` and `items`, naming the folder and the keys, instead of dropping them. `rex migrate-to-folder-tree` renames a converted `prd.json` to `prd.json.migrated`.
