---
"@n-dx/sourcevision": patch
---

Zone ids and names stay readable across runs. A placeholder name left over from an earlier numbered id ("Routes 8" on `routes-6`) is renamed instead of being kept as if someone chose it. A numbered zone with a chosen name takes its id from that name, and the old id still works in pins and `get_zone`. IDs come from the most specific directory the files share, and filename-based IDs split camelCase and drop route syntax. Renaming a zone renames its sub-zones too, and two zones no longer share a name.
