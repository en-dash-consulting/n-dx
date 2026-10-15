---
"@n-dx/hench": patch
---

`task-lookup.ts` now imports `resolveStore` and `findItem` through `src/prd/rex-gateway.ts` instead of a dynamic `import("@n-dx/rex")`.
