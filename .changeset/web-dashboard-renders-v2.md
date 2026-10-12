---
"@n-dx/web": patch
---

The dashboard renders a v2 project without breaking. v1 is unchanged.

- `ndx start` builds the PRD cache from rex's change-layer projection, and its watcher follows `product/` and `changes/`, including when they are created after start. The task list, Live and the merge graph now show titles instead of "No PRD data found".
- `POST /api/rex/items` (Quick Add) creates a change in the Inbox through the change-layer store and ignores the v1 `level`. A `parentId` is refused until the type-aware CRUD of roadmap PR 21.
- `PATCH /api/rex/items/:id` and `PATCH /api/rex/items/bulk` with `status: "completed"` go through rex's v2 completion, so a change's amendments reach the product layer. Every other status goes through the change-layer store. In a bulk update a change listed before its own tasks is completed after them, and a completion rex refuses reports `ok: false` with its `error`.

Fields added to an `/api` route on a v2 project: the `POST /api/rex/items` response carries `needsPlacement: true` and `level: "change"`.
