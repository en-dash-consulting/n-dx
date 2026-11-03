---
"@n-dx/web": patch
---

The PRD tree's inline "+" add form no longer offers or sends a priority for a subtask under a v2 task, matching the detail panel's Add Subtask form; both now read one rule, `childCarriesPriority`, beside `childTypeOf` in `shared/item-type.ts`. `POST /api/rex/items` answers 400 "A subtask does not carry priority" for a v2 subtask sent with a priority, as rex's add rule does, instead of 201 with the priority silently dropped.
