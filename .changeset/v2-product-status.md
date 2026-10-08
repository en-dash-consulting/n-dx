---
"@n-dx/rex": patch
---

Compute intent status and health for v2 capabilities and constraints (`core/product-status.ts`). Status is retired, changing, proposed, revised or met. A node reads changing only while a building change (started, or placed out of the Inbox) amends it or a parent capability, so an untouched Inbox draft leaves it revised; `long-revised` uses the same definition. Health is defective when a current check fails (results for removed requirements are ignored, latest per requirement wins) or an open fix targets the node; a retired node is always ok. Both are derived on read and never written to intent or state files. v2 is still not wired to the store.
