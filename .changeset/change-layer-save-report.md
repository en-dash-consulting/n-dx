---
"@n-dx/rex": patch
---

`ChangeLayerStore` keeps a save report on v2 trees, as `FileStore` does on v1: `takeSaveFileReport` returns the project-relative files under `product/` and `changes/` that its writes created, rewrote or deleted since the last take (a removed folder is listed by its files), then `null` until the next write. `completeV2Work` writes through the store's new `withModelTransaction`, so a completion and the product files its apply touched are in the report too. Hench can then commit just those files instead of all of `product/` and `changes/`. `writePrdModel`'s result gains `deletedFiles`.
