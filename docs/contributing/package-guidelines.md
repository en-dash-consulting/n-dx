# Package Guidelines

Standards for creating and maintaining packages in the n-dx monorepo.

## Public API

Every package exposes its public surface through `src/public.ts`:

```json
{
  "exports": {
    ".": { "import": "./dist/public.js", "types": "./dist/public.d.ts" },
    "./dist/*": "./dist/*"
  }
}
```

### What to Export

| Consumption pattern | Export style | Example |
|---|---|---|
| Library (runtime imports) | Functions + types | rex: `resolveStore`, `findNextTask` |
| MCP server + filesystem reads | MCP factory + schema types | sourcevision: `createSourcevisionMcpServer` |
| CLI + filesystem reads | Types + schema constants | hench: `HenchConfig`, `RunRecord` |

### What NOT to Export

- Zod validation schemas (forces Zod as a transitive dependency)
- Internal utilities serving a single consumer
- Complex config factories with internal initialization context

## Gateway Modules

See [Gateway Modules](/architecture/gateways) for the full pattern reference.

## Type Duplication

When importing types would create unwanted build-time coupling, types are **duplicated** with compile-time consistency tests:

| Consumer | Source | Consistency test |
|----------|--------|-----------------|
| web viewer (`prd-tree/types.ts`) | rex | `type-consistency.test.ts` |

- **Import** when packages already have a runtime dependency
- **Duplicate** only when the consumer runs in the browser and can't import Node.js packages
- **Always** add a compile-time test that verifies sync

## Required Scripts

| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc` (or `tsc && node build.js`) | Compile TypeScript |
| `dev` | `tsc --watch` | Watch mode |
| `typecheck` | `tsc --noEmit` | Type checking |
| `test` | `vitest run` | Run tests |
| `validate` | `tsc --noEmit && vitest run` | Full validation |

## The `dist/*` Wildcard Export

An intentional escape hatch for integration tests and CI scripts. **Not public API** — files may be renamed or deleted without notice.

**Acceptable:** Integration tests, CI scripts, temporary gateway migration.

**Prohibited:** Production runtime imports bypassing the gateway, importing internal types when a `public.ts` export exists.

## `.rex/` Write-Access Protocol

Packages share state through filesystem rather than runtime imports:

| File | Owner | Readers | Write pattern |
|------|-------|---------|---------------|
| `prd.json` | rex (FileStore) | hench, web | Atomic read-modify-write |
| `config.json` | rex (FileStore) | hench, web | Written at init |
| `execution-log.jsonl` | rex (FileStore) | web | Append-only |
| `workflow.md` | rex (FileStore) | web | Overwritten on transitions |
| `acknowledged-findings.json` | rex (analyze) | — | Overwritten on acknowledge |

**Rules:**
1. Single writer per file
2. No file locking (sequential access assumed)
3. Readers treat missing/malformed files as non-fatal
4. Hench agent never writes `.rex/` files directly — all mutations go through Rex's store layer
