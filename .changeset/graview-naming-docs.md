---
"@n-dx/rex": patch
"@n-dx/graview": patch
---

Rex's v2 exports (the model reader, the tree index, change placement, the derived product computations and reports, and the migration plan's rules stage) are documented as experimental: like the other rex TypeScript helpers they are outside the declared freeze, while the `rex/v2` schema they follow stays soft-frozen. The Graview projection's architecture doc lists every kind and relation it names differently from rex (`under`, `release`, `landedFor` and the rest) with rex's equivalent, plus the renamed fields, and a test fails when the declaration gains a kind or relation that the table's first column does not name.
