---
"@n-dx/web": patch
---

A change completed under `rex.applyOn` `review` or `release` is no longer shown as in progress. v1 is unchanged.

- `GET /api/rex/changes` (and the open-change overlays on `GET /api/rex/product` and the capability history) report `stage: "awaiting-apply"` for a change that is completed but not applied. The Changes view lists it between In progress and Applied as "Waiting for a steward to apply it". Soft freeze: `stage` gains the value `awaiting-apply`; the other five values are unchanged.
- `PATCH /api/rex/items/:id` with `status: "completed"` on a v2 project answers `{ ok: true, applied, reason }` when rex held the change open or left it unapplied, with rex's `reason`. When nothing was held the answer is still `{ ok: true }`. Soft freeze: `applied` and `reason` are new optional fields.
