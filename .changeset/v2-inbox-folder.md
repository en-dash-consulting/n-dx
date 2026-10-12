---
"@n-dx/rex": patch
---

v2 trees store Inbox changes in the reserved `changes/inbox/` folder. A change added with no target lands in `changes/inbox/<slug>/` with `needsPlacement: true`, and placing it moves it to `changes/` with its id and slug kept. Trees that keep Inbox changes at the `changes/` root still read, and the next write moves them in. No top-level change may take the slug `inbox`.
