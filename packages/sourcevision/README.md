# @n-dx/sourcevision

> **This is an internal package of [`@n-dx/core`](https://www.npmjs.com/package/@n-dx/core).** Install `@n-dx/core` instead — it includes this package and registers all CLI commands.

<img src="SourceVision.png" alt="SourceVision" width="128">

Codebase analysis tool that produces structured, git-friendly JSON output describing your project's file inventory, import graph, architectural zones, component definitions, and route structure — with an interactive browser-based viewer and AI integration.

## Quick Start

```bash
# Install @n-dx/core — it bundles sourcevision and registers the `sourcevision` / `sv` binaries
npm install -g @n-dx/core      # or: pnpm add -g @n-dx/core / yarn global add @n-dx/core

sourcevision analyze
sourcevision serve
```

Open `http://localhost:3117` to explore results.

## What It Analyzes

**Inventory** (Phase 1) — Files, languages, line counts, roles, categories. Deterministic SHA-256 hashes.

**Imports** (Phase 2) — TypeScript/JavaScript import graph via AST analysis. Detects static, dynamic, type, require, and re-export edges. Circular dependency detection. External package tracking.

**Zones** (Phase 3) — Louvain community detection groups files into architectural zones with cohesion/coupling metrics. Optional AI enrichment (via Claude) adds meaningful names, descriptions, and findings across multiple passes.

**Components** (Phase 4) — React/Preact component definitions (function, arrow, class, forwardRef). JSX usage graph. React Router v7 / Remix flat-file route detection with convention export analysis (loader, action, meta, etc).

**AI Output** — Generates `llms.txt` and `CONTEXT.md` for LLM consumption. MCP server for real-time AI tool integration.

## CLI Reference

```
sourcevision init              Set up .sourcevision/ in the current project
sourcevision analyze [dir]     Run analysis pipeline (default: .)
sourcevision serve [dir]       Start local viewer (default: .)
sourcevision validate [dir]    Validate .sourcevision/ output files
sourcevision pr-markdown [dir] Regenerate PR markdown at .sourcevision/pr-markdown.md
sourcevision reset [dir]       Remove .sourcevision/ and start fresh
sourcevision mcp [dir]         Start MCP server for AI tool integration
```

### Options

| Flag | Description |
|------|-------------|
| `--port=N` | Server port for serve (default: 3117) |
| `--phase=N` | Run only phase N (1=inventory, 2=imports, 3=zones, 4=components) |
| `--only=MODULE` | Run only named module (inventory, imports, zones, components) |
| `--fast` | Skip AI zone-name enrichment (use algorithmic names) |

## Output Files

All output is written to `.sourcevision/`:

| File | Description |
|------|-------------|
| `manifest.json` | Metadata, git info, module status tracking |
| `inventory.json` | Complete file inventory with language/role classification |
| `imports.json` | Import graph edges, externals, circulars |
| `zones.json` | Architectural zones with metrics and findings |
| `components.json` | Component definitions, usage graph, route modules |
| `pr-markdown.md` | Regenerated PR-ready markdown based on git diff |
| `llms.txt` | Structured Markdown summary for LLM consumption |
| `CONTEXT.md` | Dense summary with XML markers for Claude parsing |

All JSON output is canonically sorted for deterministic, git-friendly diffs.

## AI Integration

### llms.txt

Generated automatically after analysis. Provides a structured Markdown summary including project identity, architecture zones, key dependencies, route structure, findings, and file inventory.

### CONTEXT.md

Optimized for Claude context windows (~8K tokens). Uses XML-style section markers (`<architecture>`, `<zones>`, `<routes>`, `<findings>`) for reliable parsing.

### MCP Server

Start the MCP server for real-time AI tool integration:

```bash
sourcevision mcp
```

Configure in your MCP client:

```json
{
  "mcpServers": {
    "sourcevision": {
      "command": "sourcevision",
      "args": ["mcp", "/path/to/project"]
    }
  }
}
```

**Tools**: `get_overview`, `get_zone`, `get_file_info`, `get_imports`, `get_route_tree`, `search_files`, `get_findings`

**Resources**: `sourcevision://summary`, `sourcevision://zones`, `sourcevision://routes`

## Viewer Guide

The browser viewer (`sourcevision serve`) provides these views:

- **Overview** — Stats grid, language breakdown, most imported files, circulars, module status
- **Import Graph** — Force-directed SVG graph colored by zone, cross-zone edges highlighted
- **Zones** — Zone cards with cohesion/coupling meters, findings, file lists
- **Files** — Searchable, filterable, sortable file table
- **Routes** — Route tree, route module table, convention coverage, component usage
- **Architecture** — Architectural patterns and relationships (requires AI enrichment pass 2)
- **Problems** — Anti-pattern findings grouped by severity (requires pass 3)
- **Suggestions** — Improvement suggestions (requires pass 4)

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Test structure:
- `tests/unit/` — Unit tests for analyzers, utils, schema validation
- `tests/integration/` — Pipeline tests, llms.txt/context generation
- `tests/e2e/` — CLI end-to-end tests against fixture projects
- `tests/fixtures/` — Small test projects (TypeScript, Remix)

## Development

```bash
npm run build         # TypeScript compile + bundle viewer
npm run dev           # TypeScript watch mode
npm run typecheck     # Type check only
```

Architecture: ESM throughout, TypeScript compiler API for AST analysis, Preact for viewer (bundled into single HTML), Zod for schema validation, Louvain algorithm for zone detection.
