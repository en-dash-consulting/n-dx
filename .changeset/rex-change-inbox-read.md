---
"@n-dx/rex": patch
"@n-dx/web": patch
---

`rex change inbox [--format=json]` lists every open change awaiting placement, oldest first: id, title, intent, age in days and the placement rules' top 5 candidates with scores and reasons. On a v1 PRD it answers "not applicable" and exits 0. A new change now records `createdAt` in its `state.yaml` row; a change recorded before that reads its age from `lastModified`. `GET /api/rex/changes/placements` rows carry the same `createdAt` and `ageDays` on their `change`.
