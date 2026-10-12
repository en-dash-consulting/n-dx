---
"@n-dx/rex": patch
"@n-dx/graview": patch
---

Rex's v2 exports (the model reader, the tree index, the derived product computations and the migration plan's rules stage) are documented as experimental until the v1-to-v2 migration applies. The Graview projection's architecture doc lists every name it uses that rex does not (`under`, `release`, `landedFor` and the rest) with rex's equivalent, and a test fails when the declaration gains a kind or relation that the table does not name.
