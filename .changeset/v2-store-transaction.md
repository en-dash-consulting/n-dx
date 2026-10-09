---
"@n-dx/rex": patch
---

Adds `withPrdModelTransaction`, the v2 write path: it loads the product and change layers, runs the caller's mutation and writes the result under one hold of the PRD lock, and refuses a v1 tree.
