---
"@n-dx/rex": patch
---

Add a dual-read PRD loader (`store/prd-model-reader.ts`) that reads either the v1 `prd_tree` (levels mapped to v2 types) or the v2 `product/` and `changes/` roots (intent merged with `state.yaml`) into one model. A schema major this build cannot read is refused with a message naming both versions and the fix; `NDX_IGNORE_SCHEMA_SKEW=1` or `--ignore-schema-skew` reads it for inspection with a stderr warning and refuses every write. v2 is still not wired to the store.
