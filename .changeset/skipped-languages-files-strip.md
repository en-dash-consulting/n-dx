---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Show analysed, inventoried-only, and skipped languages with counts on the Files page.

The Files table only ever showed `byLanguage`, so a project with a language sourcevision doesn't recognize (e.g. Zig) had its files silently dropped from the inventory during the code-only walk — nothing on the page said so. `analyzeInventory`'s summary now additionally records `skippedExtensions` (extension -> file count, for files the walker saw but excluded) and `analysedLanguages` (the subset of `byLanguage` whose files take part in import-graph and zone analysis). Both fields are optional and additive, so inventories written before this change still load.

The Files page now renders a strip above the table stating which languages were analysed, which were inventoried only, and which extensions were skipped, each with counts — reading the new fields when present and degrading to a single neutral "Inventoried" group when they're absent.
