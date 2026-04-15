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
sourcevision analyze .                    # full analysis
sourcevision analyze --fast .             # skip AI enrichment
sourcevision analyze --phase zones .      # run specific phase
sourcevision serve .                      # interactive browser viewer
sourcevision validate .                   # validate analysis output
sourcevision export-pdf .                 # export analysis as PDF report
sourcevision pr-markdown .                # regenerate PR markdown summary
sourcevision git-credential-helper .      # interactive GitHub credential setup
sourcevision reset .                      # clear analysis data
sourcevision workspace .                  # aggregate multiple repos into unified view
sourcevision mcp .                        # start MCP server (stdio)
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

Zones are detected using Louvain community detection on the import graph, then refined through multiple post-processing passes (small zone absorption, satellite merging, large zone splitting). AI enrichment optionally names zones, writes descriptions, and generates per-zone context files.

For a thorough explanation of the Louvain algorithm, findings system, risk assessment, and all configuration options, see [SourceVision Analysis Deep Dive](./sourcevision-analysis).

See [Zone Naming Conventions](/architecture/zone-naming-conventions) for naming standards.

## MCP Tools

Available via `sourcevision mcp .` (stdio) or `ndx start .` (HTTP). Claude Code prefixes these as `mcp__sourcevision__{tool}`; Codex uses bare names.

| Tool | Description |
|------|-------------|
| `get_overview` | Project summary statistics |
| `get_next_steps` | Prioritized improvement recommendations |
| `get_zone` | Architectural zone details |
| `get_findings` | Analysis findings (anti-patterns, suggestions, observations) |
| `get_file_info` | File inventory entry, zone, and imports |
| `search_files` | Search inventory by path, role, or language |
| `get_imports` | Import graph edges |
| `get_classifications` | File archetype classifications |
| `set_file_archetype` | Override archetype classification for a file |
| `get_route_tree` | Route structure (pages, API routes, layouts) |
