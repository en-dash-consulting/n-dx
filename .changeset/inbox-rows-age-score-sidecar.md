---
"@n-dx/web": patch
---

Inbox rows show the change's age, its top suggestion's score beside the strength chip, and Place with Sidecar while `web.sidecar` is on. The Inbox count and list follow rex's rule (every open change with `needsPlacement`, including on a tree with no capability yet), matching `get_prd_status`, and the empty state says a held change cannot close and `ndx work` skips its tasks until it is placed.
