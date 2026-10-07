---
"@n-dx/rex": patch
---

Compute intent status and health for v2 capabilities and constraints (`core/product-status.ts`). Status is retired, changing, proposed, revised, failing or met; health is defective when a check fails or an open fix touches the node. Both are derived on read and never written to intent or state files. v2 is still not wired to the store.
