# Packages

n-dx is a set of `@n-dx/*` packages in a strict dependency hierarchy. All of them are published together at one version; the member list is the `fixed` group in [`.changeset/config.json`](https://github.com/en-dash-consulting/n-dx/blob/main/.changeset/config.json).

```
  @n-dx/core                    CLI orchestrator (spawns the tool CLIs)
       ↓
  hench                         agent loops, tool dispatch
       ↓
  rex · sourcevision            PRD management · static analysis
  @n-dx/lang-runtime, lang-*    language packs (loaded by sourcevision, never imported)
       ↓
  @n-dx/llm-client              shared types, API client
  @n-dx/lang-kit                language facts, pack contract
```

Three packages sit beside the hierarchy:

- `@n-dx/web` is a coordination layer, importing from both domain packages through gateway modules.
- `@n-dx/graview` projects the PRD, the analysis and the runs into a Graview document for `ndx graview`.
- `@n-dx/graview-face` is the Vite + React app that `ndx graview serve` runs; no other package depends on it.

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

All packages are published under the `@n-dx/` scope. The root package `@n-dx/core` depends on the tool packages and registers CLI commands on install. The language packs are opt-in; `@n-dx/lang-go` is an optional dependency of sourcevision.

| npm Package | CLI Commands | Description |
|-------------|-------------|-------------|
| `@n-dx/core` | `ndx`, `n-dx` | Orchestration entry point |
| `@n-dx/rex` | `rex` | PRD management |
| `@n-dx/hench` | `hench` | Autonomous agent |
| `@n-dx/sourcevision` | `sourcevision`, `sv` | Static analysis |
| `@n-dx/llm-client` | — | LLM foundation (library only) |
| `@n-dx/web` | — | Dashboard + MCP server |
| `@n-dx/lang-kit` | — | Language facts and the pack contract (library only) |
| `@n-dx/lang-runtime` | — | Tree-sitter runtime the packs share (library only) |
| `@n-dx/lang-go`, `@n-dx/lang-java`, `@n-dx/lang-python`, `@n-dx/lang-sql`, `@n-dx/lang-terraform` | — | Language packs; install with `ndx sv pack add <lang>` |
| `@n-dx/graview` | `ndx-graview` (run as `ndx graview`) | Graview projection |
| `@n-dx/graview-face` | `ndx-graview-face` (run as `ndx graview serve`) | Graview product face |

## Public API

Every package exposes its public surface through `src/public.ts`, mapped to `exports["."]` in `package.json`. See [Package Guidelines](/contributing/package-guidelines) for the full convention.

## Development

```sh
pnpm build          # build all packages
pnpm test           # test all packages
pnpm typecheck      # typecheck all packages

# Per-package
pnpm --filter @n-dx/rex build
pnpm --filter @n-dx/sourcevision test
pnpm --filter @n-dx/hench typecheck
```
