---
"@n-dx/web": patch
---

The hub no longer spawns a binary recorded in an older `hub.json`. On start it drops each record's saved `ndxBin`, rewrites the registry, and spawns every project server from its own entry; a server such a record left running is replaced rather than adopted.
