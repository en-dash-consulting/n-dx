---
"@n-dx/rex": patch
---

Every PRD tool opens a v2 tree, and none can split it.

- Store resolution is layout-aware. On a v2 PRD (`product/` present) `resolveStore` returns the change-layer store, so commands that open the PRD through it read and write the change layer instead of failing with "Rex directory not found". The new `resolveV1Store` keeps `migrate-slugs` v1-only. The v1 store refuses to read or write a v2 tree, with an error naming the v2 layout. The "Run 'n-dx init'" hint appears only when the project has no PRD in either layout.
- Nothing splits a v2 tree: `rex init` no longer scaffolds `prd_tree/` beside `product/`, and `rex migrate-to-folder-tree`, `migrate-to-md` and `migrate-folder-tree-filenames` refuse on a v2 tree, writing nothing. A stray `.rex/prd.json` beside a v2 tree is no longer migrated into `prd_tree/` (the migration reports `reason: "v2-layout"`), and a stray `prd_tree/` no longer overrides the change layer in `status`, `tree`, `next` and `validate`.
- The rex MCP tools serve a v2 PRD: `edit_item`, `move_item`, `merge_items`, `claim_task`, `release_task`, `verify_criteria`, `facets`, `health`, `reorganize` and `get_token_usage`. On a v2 tree `move_item` follows node types (a task moves between changes; a change never goes under a task), `merge_items` merges sibling changes only (carrying their `touches`, and refusing to absorb a change that carries amendments), `edit_item` refuses `level`, and `claim_task` claims a task or a change with no tasks.
- The rex CLI serves a v2 tree: `status`, `tree`, `update`, `move`, `remove`, `ready`, `verify`, `fix`, `validate` and `report`. `rex move` and MCP `move_item` can nest a change under another change. `rex analyze`, `rex recommend --accept` and `rex restore` refuse on a v2 tree with a sentence naming what to use instead. `ndx status` and `ndx ci` pass on a v2 project. On a v2 tree `rex validate` skips the v1 hierarchy-placement and empty-container checks, so a change nested under a change passes, and `rex reorganize` and MCP `reorganize` no longer propose v1 orphaned-feature or single-child collapses.
- `restoreFromBackup` and `getAvailableBackups` refuse on a v2 tree by throwing `V2RestoreRefusedError` (exported from `public.ts`), so the dashboard's restore route can no longer swap a v1 snapshot in beside `product/`. `rex restore` prints the same sentence as before.
- v1 trees behave as before.

MCP fields added on a v2 tree (optional, absent on v1; MCP tool shapes are soft-frozen since 0.9.0):

- `merge_items`: on a v2 tree the absorbed changes' ids and display ids (and their former aliases) are recorded as `aliases` on the target (the target item's `aliases` field, optional, absent on v1), so `get_item` and `N-DX-Item` trailers naming an absorbed change still resolve to the target.
- `edit_item`: `item.type`, `item.displayId` and the item's other v2 fields (`slug`, `touches`, `amends`, …), as stored.
- `move_item`: `type`.
- `claim_task`: `type`.
- `update_task_status`: items listed in `autoCompleted` carry the projected item's v2 fields (`type`, `slug`, `displayId`, `body`, `amends`, …), as stored.

MCP values changed on a v2 tree (the field is unchanged and v1 answers as before):

- `get_capabilities`: `adapter` reads `"v2-change-layer"` and `supportsWatch` reads `false`, the change-layer store's values.

`rex validate` on a v2 tree no longer runs the `tree identity`, `tree slug convention` and `tree slug rule marker` checks against a stray `.rex/prd_tree/`.
