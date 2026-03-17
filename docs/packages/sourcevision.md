<img src="/sourcevision.png" alt="SourceVision" width="96" style="float: right; margin: 0 0 1rem 1rem;" />

# SourceVision

Static analysis engine that inventories files, maps imports, detects architectural zones, and catalogs React components.

## What It Does

SourceVision runs a 4-phase analysis pipeline:

1. **Inventory** — Scan all files, classify by type and role
2. **Imports** — Build the dependency graph
3. **Zones** — Detect architectural communities via Louvain algorithm, then enrich with AI
4. **Components** — Catalog React components with props and usage patterns

## CLI

```sh
sourcevision analyze .           # full analysis
sourcevision analyze --fast .    # skip AI enrichment
sourcevision analyze --phase zones .  # run specific phase
sourcevision serve .             # interactive browser viewer
sourcevision mcp .               # start MCP server (stdio)
sourcevision validate .          # validate analysis output
sourcevision reset .             # clear analysis data
```

The `sv` command is an alias for `sourcevision`.

## Output Files

All output is written to `.sourcevision/`:

| File | Contents |
|------|----------|
| `manifest.json` | Analysis metadata, version, timestamps |
| `inventory.json` | File listing with classifications |
| `imports.json` | Dependency graph (edges + metadata) |
| `zones.json` | Architectural zone map with cohesion/coupling metrics |
| `components.json` | React component catalog |
| `llms.txt` | AI-readable codebase summary |
| `CONTEXT.md` | Detailed AI context document |
| `zones/{zone-id}/` | Per-zone context and summary files |

## Findings

SourceVision produces findings in several categories:

| Type | Description | Actionable? |
|------|-------------|-------------|
| `anti-pattern` | Architectural violations (circular deps, high coupling) | Yes |
| `suggestion` | Improvement recommendations | Yes |
| `move-file` | File placement recommendations | Yes |
| `observation` | Metric descriptions ("Cohesion is 0.36") | No |
| `pattern` | Detected code patterns | No |
| `relationship` | Dependency descriptions | No |

The `--actionable-only` flag on `ndx recommend` filters to only the first three types.

## Viewer

```sh
sourcevision serve .    # opens browser viewer
ndx start .             # includes viewer in dashboard
```

The viewer provides 8 views: Overview, Imports, Zones, Files, Routes, Architecture, Problems, and Suggestions.

## Zone Detection

Zones are detected using Louvain community detection on the import graph. Post-processing:

- Small zones (<=8 files, coupling > 0.3) are absorbed into their most-connected neighbor
- AI enrichment names zones, writes descriptions, and generates context files
- Zone IDs use kebab-case; zone names use Title Case

See [Zone Naming Conventions](/architecture/zone-naming-conventions) for naming standards.
