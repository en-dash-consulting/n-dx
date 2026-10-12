---
"@n-dx/rex": patch
---

`@n-dx/rex` exports the v2 PRD model and what is derived from it: `loadPrdModel` and `prdLayout` (one reader for both layouts; a v1 tree reads as changes only), the v2 node and tree types, `indexTree`, `computeEdges`, `computeProductStatus`, `computeRealizedBy`, `deriveChangeKind`, and the product, capability and status report builders. Until now every one of these was internal, so a consumer of the product layer — the dashboard's Product, Changes and Capability views, or a projection of the graph into another tool — could reach them only through a `dist/*` import the package guidelines forbid. Zod schemas stay off the public surface.

Also public: `loadTrailerCommits` (every `N-DX-Item` commit on main, now with its `subject`), `computeLandings`, and the release tags read once (`listReleaseTags`, one per version in creation order, a changesets monorepo's `<package>@X.Y.Z` tags folded to one) with the release each of many commits first shipped in (`releasesContaining`, the `resolveShippedIn` answer in one walk). The trailer, landing and commit-files caches rebuild once under the new format version.

The v1-to-v2 plan's rules stage is public too: `classifyV1Tree` (where each v1 item lands in v2) and `draftCapabilitySpecs` (the template capability specs), with their types. Both are pure; nothing here writes.
