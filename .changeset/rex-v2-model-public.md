---
"@n-dx/rex": patch
---

`@n-dx/rex` exports the v2 PRD model and what is derived from it: `loadPrdModel` and `prdLayout` (one reader for both layouts; a v1 tree reads as changes only), the v2 node and tree types, `indexTree`, `computeEdges`, `computeProductStatus`, `computeRealizedBy`, `deriveChangeKind`, and the product, capability and status report builders. Until now every one of these was internal, so a consumer of the product layer — the dashboard's Product, Changes and Capability views, or a projection of the graph into another tool — could reach them only through a `dist/*` import the package guidelines forbid. Zod schemas stay off the public surface.
