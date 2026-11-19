---
"@n-dx/web": patch
---

The Inbox and Open changes list prioritized changes first, then by priority critical to low, and a change's detail panel has a `Prioritized` checkbox to set or clear the flag.

A change with no priority sorts as medium. In the Inbox, rex's placement guess now orders changes only within the same flag and priority; on Open changes and Plan's open-changes glance, ties keep their previous order. Prioritized rows carry a `Prioritized` tag. `PATCH /api/rex/items/:id` accepts `prioritized` (a boolean; `false` removes it) on a change or v1 epic only; the bulk route refuses it.
