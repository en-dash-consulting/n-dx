---
"@n-dx/web": patch
---

The dashboard server reads, places and proposes Inbox changes on a v2 project: `GET /api/rex/changes/:id/placement`, `POST …/place` and `POST …/propose`. `/api/status` reports `rex.inbox`, change rows carry `awaitsPlacement`, and `POST /api/rex/items` accepts `touches`.
