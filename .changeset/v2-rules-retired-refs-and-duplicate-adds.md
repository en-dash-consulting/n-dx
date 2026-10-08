---
"@n-dx/rex": patch
---

The v2 rules now reject an open change that touches, modifies or adds under a retired product node (`open-change-refs-live` covers every product reference, not only removals), and a change that adds the same target twice (`ref-resolves`; the first addition still stands). Applied changes may still reference retired nodes.
