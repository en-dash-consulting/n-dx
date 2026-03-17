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

<div style="display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 1.5rem 0;">
  <a href="./sourcevision" style="text-align: center; text-decoration: none; color: inherit;">
    <img src="/sourcevision-f.png" alt="SourceVision" width="80" /><br/>
    <strong>SourceVision</strong><br/>
    <span style="font-size: 0.85em; opacity: 0.8;">Static analysis engine</span>
  </a>
  <a href="./rex" style="text-align: center; text-decoration: none; color: inherit;">
    <img src="/rex-f.png" alt="Rex" width="80" /><br/>
    <strong>Rex</strong><br/>
    <span style="font-size: 0.85em; opacity: 0.8;">PRD management</span>
  </a>
  <a href="./hench" style="text-align: center; text-decoration: none; color: inherit;">
    <img src="/hench-f.png" alt="Hench" width="80" /><br/>
    <strong>Hench</strong><br/>
    <span style="font-size: 0.85em; opacity: 0.8;">Autonomous agent</span>
  </a>
  <a href="./llm-client" style="text-align: center; text-decoration: none; color: inherit;">
    <strong>@n-dx/llm-client</strong><br/>
    <span style="font-size: 0.85em; opacity: 0.8;">LLM foundation</span>
  </a>
  <a href="./web" style="text-align: center; text-decoration: none; color: inherit;">
    <strong>@n-dx/web</strong><br/>
    <span style="font-size: 0.85em; opacity: 0.8;">Dashboard + MCP</span>
  </a>
</div>

| Package | Key Commands | Output Directory |
|---------|-------------|-----------------|
| [SourceVision](./sourcevision) | `analyze`, `serve`, `mcp` | `.sourcevision/` |
| [Rex](./rex) | `add`, `status`, `recommend`, `analyze` | `.rex/` |
| [Hench](./hench) | `run`, `status`, `show` | `.hench/` |
| [LLM Client](./llm-client) | (library only) | — |
| [Web Dashboard](./web) | via `ndx start` | — |

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
