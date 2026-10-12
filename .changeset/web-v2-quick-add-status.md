---
"@n-dx/web": patch
---

On a v2 project, `POST /api/rex/items` (Quick Add) creates a change in the Inbox through the change-layer store and ignores the v1 `level`; a `parentId` is refused until the type-aware CRUD of roadmap PR 21. `PATCH /api/rex/items/:id` with `status: "completed"` goes through rex's v2 completion, and every other status through the change-layer store. v1 is unchanged. Field added to an `/api` route on v2: the `POST /api/rex/items` response carries `needsPlacement: true` and `level: "change"`.
