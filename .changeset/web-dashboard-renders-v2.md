---
"@n-dx/web": patch
---

The dashboard renders a v2 project without breaking. v1 is unchanged.

- `ndx start` builds the PRD cache from rex's change-layer projection, and its watcher follows `product/` and `changes/`, including when they are created after start. The task list, Live and the merge graph now show titles instead of "No PRD data found".
- `POST /api/rex/items` (Quick Add) creates a change in the Inbox through the change-layer store and ignores the v1 `level`. A `parentId` is refused until the type-aware CRUD of roadmap PR 21.
- `PATCH /api/rex/items/:id` and `PATCH /api/rex/items/bulk` with `status: "completed"` go through rex's v2 completion, so a change's amendments reach the product layer. Every other status goes through the change-layer store. In a bulk update a change listed before its own tasks is completed after them, and a completion rex refuses reports `ok: false` with its `error`. A completing PATCH that also carries fields completes first and writes the fields only if rex accepted it, so a refused completion saves nothing; if the fields are refused after the completion was saved, the error says the item was completed.

- `GET /api/rex/backups` and `POST /api/rex/restore` answer 409 on a v2 project, instead of listing v1 snapshots or splitting the tree with one. Rex's refusal wording is the `error`.
- On a v2 project, merges follow rex's change-layer rule, the one MCP `merge_items` applies. This covers `POST /api/rex/items/merge` (preview included), the merges accepted through `POST /api/rex/apply-refinements`, and `GET /api/rex/reorganize` with `POST /api/rex/reorganize/apply`. Only sibling changes merge. A change that carries amends is never absorbed. The absorbed change's touches move to the target, and its id, display id and aliases become the target's aliases. A refused merge answers 400 with rex's reason and writes nothing; a refused refinement merge reports `invalid` with that reason. Reorganize on v2 does not propose the v1 orphan move or single-child collapse.

Fields added to an `/api` route on a v2 project: both restore routes answer `409 { ok: false, code: "V2_RESTORE_REFUSED", error }`; the `POST /api/rex/items` response carries `needsPlacement: true` and `level: "change"`.
