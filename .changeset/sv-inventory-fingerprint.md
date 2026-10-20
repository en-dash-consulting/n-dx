---
"@n-dx/sourcevision": patch
---

An incremental `sv analyze` reuses `inventory.json` entries only when `.sourcevision/.cache/inventory-fingerprint.json`, a hash of the sourcevision version and the merged language config, matches. The first incremental analyze after upgrading therefore rebuilds the whole inventory and writes that file. It is machine-local and safe to delete; a missing fingerprint, like `--full`, rebuilds the inventory in full.
