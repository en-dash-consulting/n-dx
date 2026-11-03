---
"@n-dx/web": patch
---

Snapshot workspace run IDs before each manual flow starts, so its Live task waiter cannot open a prior leg's completed run. Report malformed run lists and bounded wait failures explicitly.
