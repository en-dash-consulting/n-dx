---
"@n-dx/web": patch
---

Plan's lifecycle strip says when an Inbox change is also counted in a stage. On a tree with no live capability nothing can be held, so `GET /api/rex/changes/summary` carries `inboxInStage` and the strip notes it beside the Inbox count; nothing shows when it is zero.
