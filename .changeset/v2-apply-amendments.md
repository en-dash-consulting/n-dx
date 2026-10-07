---
"@n-dx/rex": patch
---

Add the v2 apply engine (`core/apply-amendments.ts`). It applies a change's amendments to the product layer with no model call. `added` creates a capability under an area or capability. `modified` writes the proposed statement and adds, replaces or removes criteria by id. `removed` retires the node by setting its status to `deleted`. Each amended node gets a History line, and each added or modified node gets `metAt`, the hash of its statement and criteria only, so editing the prose body never changes it. The change gets `appliedIn`. A change that only touches nodes leaves `product/` byte-identical. Any problem refuses the whole apply and leaves the tree as it was. v2 is still not wired to the store.
