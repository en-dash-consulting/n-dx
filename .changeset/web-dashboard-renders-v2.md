---
"@n-dx/web": patch
---

The dashboard renders a v2 project without breaking. v1 is unchanged.

- `ndx start` builds the PRD cache from rex's change-layer projection, and its watcher follows `product/` and `changes/`, including when they are created after start. The task list, Live and the merge graph now show titles instead of "No PRD data found".
- `POST /api/rex/items` (Quick Add) creates a change in the Inbox through the change-layer store and ignores the v1 `level`. A `type` other than absent or `change` (capability, task, subtask) is refused with a reason and writes nothing, and so is a `parentId`; the reason points to `rex add --type=<type> --parent=<id>` or MCP `add_item`.
- `PATCH /api/rex/items/:id` and `PATCH /api/rex/items/bulk` with `status: "completed"` go through rex's v2 completion, so a change's amendments reach the product layer. Every other status goes through the change-layer store. In a bulk update a change listed before its own tasks is completed after them, and a completion rex refuses reports `ok: false` with its `error`. A completing PATCH that also carries fields completes first and writes the fields only if rex accepted it, so a refused completion saves nothing; if the fields are refused after the completion was saved, the error says the item was completed.

- `GET /api/rex/backups` and `POST /api/rex/restore` answer 409 on a v2 project, instead of listing v1 snapshots or splitting the tree with one. Rex's refusal wording is the `error`.
- On a v2 project, merges follow rex's change-layer rule, the one MCP `merge_items` applies. This covers `POST /api/rex/items/merge` (preview included), the merges accepted through `POST /api/rex/apply-refinements`, and `GET /api/rex/reorganize` with `POST /api/rex/reorganize/apply`. Only sibling changes merge. A change that carries amends is never absorbed. The absorbed change's touches move to the target, and its id, display id and aliases become the target's aliases. A refused merge answers 400 with rex's reason and writes nothing; a refused refinement merge reports `invalid` with that reason. Reorganize on v2 does not propose the v1 orphan move or single-child collapse.
- The Product and Changes views are on the Plan page, fed from rex's v2 model: the product map with rex's computed status and health and the open changes against each capability, a capability's page with its criteria and the applied changes that moved it, and changes grouped by planned release and stage. On a v1 project both say to run `ndx migrate`. They refetch on `rex:prd-changed`, so they follow the Tasks tree after a Quick Add or an applied change without a reload.

Fields added to an `/api` route on a v2 project: new read routes `GET /api/rex/product` (`{ layout, map }`), `GET /api/rex/changes` (`{ layout, changes }`) and `GET /api/rex/product/capability/:id` (`{ layout, capability }`, 404 for an id naming no live capability); on a v1 project each answers `{ layout: "v1" }`. Both restore routes answer `409 { ok: false, code: "V2_RESTORE_REFUSED", error }`; the `POST /api/rex/items` response carries `type: "change"` and `needsPlacement: true`, and no `level`.

A change completed under `rex.applyOn` `review` or `release` is no longer shown as in progress. v1 is unchanged.

- `GET /api/rex/changes` (and the open-change overlays on `GET /api/rex/product` and the capability history) report `stage: "awaiting-apply"` for a change that is completed but not applied. The Changes view lists it between In progress and Applied as "Waiting for a steward to apply it". Soft freeze: `stage` gains the value `awaiting-apply`; the other five values are unchanged.
- `PATCH /api/rex/items/:id` with `status: "completed"` on a v2 project answers `{ ok: true, applied, reason }` when rex held the change open or left it unapplied, with rex's `reason`. When nothing was held the answer is still `{ ok: true }`. Soft freeze: `applied` and `reason` are new optional fields.

`GET /api/rex/product/capability/:id` says whether the capability was ever met and whether its spec moved since, so a client can decide editorial eligibility without reading the display status (`changing` outranks `revised` and `proposed`). Soft freeze: `met` (`metAt` is recorded) and `specChangedSinceMet` (`metAt` is recorded and the spec no longer hashes to it) are new required booleans on `capability`.
