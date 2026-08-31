---
name: iso-map
description: Render an interactive 3D isometric map of a codebase as a single standalone HTML file. Works on any repository — uses sourcevision analysis when present, otherwise scans the project directly. Use when someone asks to visualize, map, or diagram a codebase's architecture, see how packages or modules depend on each other, get a visual overview of an unfamiliar repo, or produce a shareable architecture picture.
argument-hint: "[dir] [--max-nodes=N] [--source=auto|sourcevision|scan]"
---

Render a codebase as an interactive isometric map: every zone of the project
becomes an extruded 3D block, sized by how much code is in it and connected by
its import relationships. The output is one self-contained HTML file that can be
opened from disk, committed, or attached to a review.

## Running it

```sh
node scripts/iso-map.mjs [dir] [options]
```

Use the skill's own directory to locate the script — it sits at
`scripts/iso-map.mjs` relative to this file. Node 18+ is the only requirement;
the script has no dependencies and installs nothing.

| Option | Effect |
|---|---|
| `--out=<path>` | Output file (default `<dir>/iso-map.html`) |
| `--max-nodes=<n>` | Cap drawn zones, largest first (default 40) |
| `--no-externals` | Drop the shared third-party dependency column |
| `--source=<mode>` | `auto` (default), `sourcevision`, or `scan` |
| `--title=<text>` | Override the page title |
| `--link-base=<url>` | Base URL for source links (default: the git remote, pinned to HEAD) |
| `--analyzed-at=<t>` | Timestamp to stamp (default: the HEAD commit time) |
| `--json` | Also print the model to stdout, for inspection |

After it runs, tell the user the output path and offer to open it. On macOS
`open <path>`; on Linux `xdg-open <path>`.

## Two input paths

The script picks its input automatically:

1. **`.sourcevision/` present** — reads `zones.json`, `inventory.json`,
   `imports.json`, and optionally `classifications.json`. This gives real
   community-detected zones, cohesion and coupling scores, archetype-based
   colouring, and any findings the analysis produced.
2. **Otherwise** — scans the project itself: walks source files (skipping
   `node_modules`, build output, and plain directory names from `.gitignore`),
   groups them into zones by directory structure, and extracts imports by
   regex for JavaScript/TypeScript, Python and Go. It resolves tsconfig `paths`
   aliases, workspace package names, and Go intra-module imports through
   `go.mod`, so a monorepo's own packages do not show up as third-party.

Force either with `--source=sourcevision` or `--source=scan`. The rendered page
states which mode produced it, so a reader always knows how much to trust it.

## Reading the map

- **Block footprint** scales with file count, **height** with line count. The
  tall wide blocks are where the code actually is.
- **Colour** is what the zone mostly does: entry points, business logic, data,
  UI, gateways, support, tests, or third-party.
- **Columns** are dependency layers. Things on the left are depended upon by
  things to their right.
- **Solid connectors** point from the importer to what it imports; thickness
  scales with how many imports there are.
- **Dashed connectors** run backwards through the layering — those two zones
  are in a dependency cycle.
- Clicking a block opens its files, metrics and cross-zone edges; clicking a
  connector explains that one dependency. The legend filters by kind. Drag to
  pan, scroll to zoom, `Esc` clears the selection.
- **Colour is doubled by a glyph** (▶ entry, ◆ logic, ▤ data, ▣ UI, ⇄ gateway,
  ○ support, ✓ tests, ◇ third-party) so the map reads without colour vision.
  The page follows the reader's light/dark preference and honours
  `prefers-reduced-motion`.
- When the analysis includes a call graph, a **Weight: imports / calls** toggle
  appears. Switching to calls re-strokes the connectors by runtime call count,
  which is closer to real behaviour than imports. An edge with calls but no
  imports is an injected or event-driven seam, and the panel says so.

## Declaring what analysis cannot see

Two things no import graph can show. Both are read from `.n-dx.json` under
`sourcevision.isoMap`, and both render in a distinct colour with a panel saying
they were declared rather than inferred:

- **`injectionSeams`** — a callback or event seam whose runtime direction is the
  reverse of the import. `{ "from": "...", "to": "...", "callbacks": ["onX"],
  "note": "why" }`; `from`/`to` accept a zone id, a file path or a directory.
- **`infrastructure`** — a queue, bucket, cache or database.
  `{ "id": "...", "name": "...", "kind": "queue", "usedBy": ["src/core"] }`.

Terraform is also scanned automatically: `resource "aws_sqs_queue" "ingest"`
becomes a node, attributed to the zones whose source names it.

A declaration that cannot be drawn is reported in the page footer, never
silently dropped.

## What to tell the user

Lead with what the map shows about *their* codebase, not with the fact that a
file was written. Good things to point out after generating one:

- The largest blocks, and whether that matches where they think the complexity
  is.
- Any dashed connectors — dependency cycles are usually news.
- Zones sitting in a layer that surprises them (a "utility" zone that everything
  depends on, a test zone importing production code in the wrong direction).
- If it ran in scan mode, that running a real analysis first would sharpen the
  zones considerably.

## Honest limits

Say these plainly if the user starts treating the map as a runtime diagram. The
rendered page also states them in its own footer.

- **Edges are imports, not data flow.** A connector means "this zone imports
  that one", not "a request travels this way".
- **Runtime infrastructure is declared, not detected.** Queues, caches, buckets
  and databases appear only from `.n-dx.json` or Terraform, and a zone is
  attributed to one by naming it in source — weaker than an import.
- **Injection inverts direction.** A callback or event seam runs the opposite
  way at runtime from how the import is drawn. Declared seams are drawn the
  right way round; undeclared ones are not.
- **In scan mode, zones come from directory structure**, which reflects how code
  is filed rather than how it is organised, and imports come from regexes, so
  path aliases and build-tool mapping can be missed.

## Tuning

- Large repositories: the default 40 zones is busy. `--max-nodes=15` usually
  reads far better, and the page names the zones it left out.
- If zones look wrong in scan mode, the grouping heuristic keys off workspace
  containers (`packages/`, `apps/`, `services/`) and source roots (`src/`,
  `lib/`, `app/`, `internal/`, `pkg/`).
- Pass `--link-base` to make the key-file lists clickable when there is no git
  remote, or when the map should point at somewhere other than `origin`.

## Editing this skill

`scripts/iso-map.mjs` is a **generated file** — it is bundled from
`packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` in the n-dx
repository, so the map has exactly one implementation rather than a copy that
silently drifts. Do not hand-edit it. Change the TypeScript and re-run:

```sh
node scripts/build-iso-skill.mjs
```

`tests/e2e/iso-skill-drift.test.js` fails if the committed bundle is stale.

If you are reading this in a repository where the skill was installed on its
own, there are no TypeScript sources alongside it — the script is standalone and
self-contained by design, and editing it directly is fine there.
