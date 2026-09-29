---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Add a folder-layout resolver and a paths module per package.

n-dx keeps its state in three dot-directories and five loose `.n-dx*` files, named
directly at roughly 380 source files. `resolveLayout` in `@n-dx/llm-client` makes that
one decision in one place: it reads a `.ndx/` container first and falls back to the
legacy layout silently, so existing projects keep working untouched. Each package gains
a paths module (`resolveRexPaths`, `resolveSourcevisionPaths`, `resolveHenchPaths`,
`resolveWebPaths`) as the single home for its own folder names, and the orchestration
tier gets a hand-written twin in `packages/core/layout.js` — it may not import from any
package tier — pinned to the canonical implementation by a contract test.

No call sites are rewired yet, so behaviour is unchanged.
