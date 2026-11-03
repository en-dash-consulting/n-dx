---
"@n-dx/core": patch
"@n-dx/llm-client": patch
---

Refuse a credential write to a machine-local config path git tracks even when nothing is on disk there (a deleted tracked file, a sparse checkout) or only a committed dangling symlink is. The local-config classifier now counts an lstat-visible entry as present, and `isLocalConfigTracked` takes `evenIfAbsent` for writers.
