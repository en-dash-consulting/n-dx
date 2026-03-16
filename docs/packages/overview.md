# Packages

n-dx is composed of five packages in a strict dependency hierarchy.

```
  hench                         agent loops, tool dispatch
       ↓
  rex · sourcevision            PRD management · static analysis
       ↓
  @n-dx/llm-client              shared types, API client
```

The `@n-dx/web` package sits alongside these as a coordination layer, importing from both domain packages through gateway modules.

## Package Summary

| Package | Role | Key Commands | Output Directory |
|---------|------|-------------|-----------------|
| [SourceVision](./sourcevision) | Static analysis engine | `analyze`, `serve`, `mcp` | `.sourcevision/` |
| [Rex](./rex) | PRD management | `add`, `status`, `recommend`, `analyze` | `.rex/` |
| [Hench](./hench) | Autonomous agent | `run`, `status`, `show` | `.hench/` |
| [LLM Client](./llm-client) | Vendor-neutral LLM foundation | (library only) | — |
| [Web Dashboard](./web) | Dashboard + MCP server | via `ndx start` | — |

## Naming Convention

| Pattern | When | Examples |
|---------|------|---------|
| Unscoped short name | CLI tools (for `npx`/`pnpm exec`) | `rex`, `sourcevision`, `hench` |
| `@n-dx/` scoped | Internal-only packages | `@n-dx/web`, `@n-dx/llm-client` |

## Public API

Every package exposes its public surface through `src/public.ts`, mapped to `exports["."]` in `package.json`. See [Package Guidelines](/contributing/package-guidelines) for the full convention.

## Development

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages

# Per-package
pnpm --filter rex build
pnpm --filter sourcevision test
pnpm --filter hench typecheck
```
