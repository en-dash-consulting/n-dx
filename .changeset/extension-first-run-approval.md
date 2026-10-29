---
"@n-dx/core": patch
---

The first `ndx <name>` of an unapproved extension shows its package, version, source, commands and sidecar and asks before running it. A yes records the approval, the same as `ndx extensions enable`. Without a terminal, or on a no, the command exits 2 and names `ndx extensions enable <name>`.
