---
id: "56f47d3d-d39d-4938-9923-b3735656ba7b"
type: "capability"
title: "Dead Import and Unused Export Elimination Across All Packages"
slug: "dead-import-and-unused-export"
statement: "The n-dx packages' production source carries no unused imports, no exports without an external consumer outside the public.ts and gateway surfaces, and no stale import paths or deprecated Node.js APIs."
criteria: [{"id":"c1","text":"Every production TypeScript and JavaScript file in every package shall contain zero unused import declarations."},{"id":"c2","text":"Every exported symbol in a production file shall have at least one external consumer, unless public.ts or a gateway module lists it."},{"id":"c3","text":"When an export is removed for having no consumers, the codebase shall also drop its implementation if no call sites for it remain."},{"id":"c4","text":"The prd-tree search module shall expose SearchFacets through the single import path prd-tree/index.ts, which re-exports it from search-types.ts, and tree-search.ts shall not re-export it."},{"id":"c5","text":"Rex CLI command modules under packages/rex/src/cli/commands/ shall import only from public.ts or core/."},{"id":"c6","text":"Production source files shall import moved or renamed internal modules from their current locations, leaving no unresolved module paths."},{"id":"c7","text":"Production source files shall contain no uses of deprecated Node.js built-in APIs such as fs.exists or url.parse, and shall use modern equivalents such as fs.access and new URL()."},{"id":"c8","text":"ESM-target files shall load modules with ESM imports and contain no CommonJS require() calls."}]
source: "smart-add"
---

Run a static-analysis pass over all production TypeScript and JavaScript source files to enumerate imports that are never referenced and exports that have zero external consumers. Remove each confirmed dead symbol and verify the build and full test suite remain green. Excludes intentional public API surfaces in public.ts files.
