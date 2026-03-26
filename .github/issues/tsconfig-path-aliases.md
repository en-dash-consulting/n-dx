## Problem

TypeScript path aliases configured in `tsconfig.json` (e.g., `@/components`, `@/lib`, `~/utils`) are classified as **external packages** instead of being resolved to internal file edges. This causes the import graph to miss the majority of internal dependencies in projects using path aliases, resulting in sparse zone detection with low cohesion/coupling scores and high unzoned file counts.

## Observed Impact

Tested against grit — a mixed Go + Next.js project (309 files, 89 Go, 166 TypeScript):

- **235 import references** across 4 path aliases (`@/components`: 105, `@/config`: 80, `@/lib`: 48, `@/hooks`: 2) classified as external
- Only **2 internal TS edges** resolved out of 166 TypeScript files
- **78 unzoned files** and **0 cross-zone dependencies** on the TypeScript side
- Go side unaffected (10 correct internal edges from 89 files)

The same issue affects any project using:
- Next.js (`@/` aliases via `tsconfig.json` paths)
- Vite (`@/` or custom aliases via `vite.config.ts` resolve.alias)
- TypeScript monorepos with `paths` mapping
- Any `tsconfig.json` with `compilerOptions.paths`

## Expected Behavior

The import analyzer should:
1. Check for `tsconfig.json` (or `jsconfig.json`) in the project root
2. Read `compilerOptions.paths` and `compilerOptions.baseUrl`
3. Before classifying an import as external, check if the specifier matches a path alias pattern
4. If it matches, resolve the alias to a relative file path and emit an internal edge

## Example

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

`import { Button } from "@/components/button"` should resolve to `src/components/button.tsx` and produce an internal edge, not an external package entry for `@/components`.

## Scope

- **File:** `packages/sourcevision/src/analyzers/imports.ts`
- **Change:** Read tsconfig paths once per invocation (similar to how `go.mod` is read once for Go), expand aliases during module resolution
- **Complexity:** Medium — the path matching is glob-based (`@/*` → `./src/*`), need to handle `baseUrl`, wildcard patterns, and multiple candidates
- **Risk:** Low — only affects previously-unresolved imports; resolved imports continue through existing path

## Related

- Go integration validated this gap: Go edges resolve correctly while TS edges in the same project are mostly external
- Affects zone quality for any Next.js / Vite / TS monorepo project
