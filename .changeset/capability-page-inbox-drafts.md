---
"@n-dx/web": patch
---

A capability page lists the Inbox changes held for placement that amend or touch it, such as the draft its own spec edit makes, under "Waiting in the Inbox" with a link to each. `GET /api/rex/product/capability/:id` carries them as `inboxChanges`; they stay out of `openChanges` and the Product total.
