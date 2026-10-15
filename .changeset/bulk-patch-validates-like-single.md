---
"@n-dx/web": patch
---

`PATCH /api/rex/items/bulk` now validates `updates` with the single PATCH's
rules: `run`, ids, timestamps and other fields that route refuses answer 400
naming the field, and an empty title is refused, with nothing written. On a v2
project a completing bulk PATCH adds the optional `applied` and `reason` fields
to an id's result when its change was held open or left unapplied under
`rex.applyOn`; an applied completion stays `{id, ok: true}`. v1 is unchanged.
