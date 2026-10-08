---
"@n-dx/rex": patch
---

Handle direct edits to the v2 product layer (`core/product-edit.ts`). An editorial edit re-stamps `metAt` and records a History line. Any other edit leaves the node revised and drafts one change, with `source: product-edit` and `needsPlacement`. A later edit refreshes that draft instead of drafting a second change, and an edit back to the met spec withdraws it. A completed but unapplied draft is reported as stale and never modified. Every History line is written on one line. The v2 `depends-on-acyclic` rule now reports one finding per set of mutually dependent capabilities, on its smallest-id member with the members in sorted order, so the same cycle is reported the same way every time. Retiring a node that still has live descendants is refused unless the same change removes them too. v2 is still not wired to the store.
