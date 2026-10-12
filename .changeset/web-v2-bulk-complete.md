---
"@n-dx/web": patch
---

On a v2 project, `PATCH /api/rex/items/bulk` with `status: "completed"` goes through rex's v2 completion per id, as the single-item PATCH does, so a change's amendments reach the product layer. A completion that fails reports `ok: false` with its `error` in that id's result. v1 is unchanged. No field added to an `/api` route.
