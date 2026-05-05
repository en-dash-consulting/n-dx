---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Bump dependencies to clear Dependabot security advisories.

- `@modelcontextprotocol/sdk` ^1.25.3 → ^1.29.0 (rex, sourcevision, web) — fixes cross-client data leak via shared transport reuse (GHSA-345p-7cg4-v4c7) plus transitive `hono`, `@hono/node-server`, `path-to-regexp`, `ajv`, and `qs` advisories.
- `@anthropic-ai/sdk` ^0.85.0 → ^0.94.0 (hench, llm-client) — fixes insecure default file permissions in the local-filesystem memory tool (GHSA-p7fg-763f-g4gf).
- `vitest` ^4.0.18 → ^4.1.5 (root) — fixes transitive `vite` and `picomatch` advisories.
- Adds `pnpm.overrides` for `picomatch`, `postcss`, `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`, `qs`, and `vite` to pin patched versions in transitive dep trees.

Cleared 27 of 30 audit advisories. Remaining 3 (rollup, esbuild, and vite reached via `vitepress`) are dev-server-only docs vulns deferred to a follow-up.
