# Unified Web Viewer Architecture

This document defines the architecture for integrating sourcevision's analysis viewer with Rex PRD management into a single unified web dashboard, served by the sourcevision web server.

## Design Principles

1. **Single entry point** — One Preact app, one HTML file, one server at port 3117
2. **Section-based navigation** — Two top-level sections (Analysis, PRD Management) with views inside each
3. **Shared component library** — Common primitives reused across both sections
4. **Type decoupling** — Viewer mirrors Rex types locally; no cross-package import dependency
5. **Server-owned data** — All data flows through the existing HTTP/WebSocket server layer
6. **Progressive enhancement** — Analysis views work without Rex data and vice versa

## Current State

The viewer is already a working unified app. Sourcevision analysis views and the PRD tree view coexist in a single Preact SPA with hash-based routing. The server already serves both `/api/sv/*` and `/api/rex/*` endpoints.

What needs to happen is formalizing the component boundaries, establishing a shared component library, and structuring navigation to scale as more views are added.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Preact SPA)                                       │
│                                                             │
│  ┌──────────┐  ┌──────────────────────────────────────────┐ │
│  │ Sidebar  │  │  Main Content Area                       │ │
│  │          │  │                                          │ │
│  │ ANALYSIS │  │  ┌────────────────────────────────────┐  │ │
│  │  Overview │  │  │  Active View                       │  │ │
│  │  Graph   │  │  │                                    │  │ │
│  │  Zones   │  │  │  (renders one of the views below)  │  │ │
│  │  Files   │  │  │                                    │  │ │
│  │  Routes  │  │  └────────────────────────────────────┘  │ │
│  │  Arch.   │  │                                          │ │
│  │  Problems│  ├──────────────────────────────────────────┤ │
│  │  Suggest.│  │  Detail Panel (slides in from right)     │ │
│  │          │  │  - File details                          │ │
│  │ PRD MGMT │  │  - Zone details                          │ │
│  │  Tasks   │  │  - Task detail (with edit controls)      │ │
│  │          │  │                                          │ │
│  └──────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                        │
         │    HTTP + WebSocket    │
         ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Server (Node.js, port 3117)                                │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Static      │  │ Data Routes  │  │ API Routes        │  │
│  │ /index.html │  │ /data/*      │  │ /api/sv/*  (read) │  │
│  │ /assets/*   │  │ /data/status │  │ /api/rex/* (CRUD) │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ WebSocket                                               ││
│  │ sv:data-changed | rex:prd-changed | rex:item-updated    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
    .sourcevision/            .rex/
    manifest.json             prd.json
    inventory.json            config.json
    imports.json              execution-log.jsonl
    zones.json                workflow.md
    components.json
```

## Navigation Structure

### Sidebar Sections

The sidebar organizes views into two logical sections with a visual separator:

```
┌──────────────────┐
│  n-dx            │  ← unified brand (not "SourceVision" alone)
│  branch @ sha    │
├──────────────────┤
│  ANALYSIS        │  ← section header
│  ▣ Overview      │
│  ☑ Tasks         │  ← PRD tree (moved to top of list for prominence)
│  ⬕ Import Graph  │
│  ⬡ Zones         │
│  ☰ Files         │
│  ◇ Routes        │
│  ◨ Architecture  │  ← requires enrichment pass
│  ⚠ Problems      │  ← requires enrichment pass
│  ✨ Suggestions   │  ← requires enrichment pass
├──────────────────┤
│  Analysis: 3/4   │  ← module completion progress bar
│  ✓✓✓○            │
└──────────────────┘
```

The "Tasks" view already exists at `#prd` and is positioned second in the nav. It naturally straddles analysis and PRD management — it shows the PRD hierarchy alongside analysis data.

### Hash Routes (unchanged)

```
#overview       → Dashboard with key metrics
#prd            → PRD tree + task management
#graph          → Force-directed import graph
#zones          → Architectural zone visualization
#files          → File listing with filters
#routes         → Routes and components
#architecture   → Architecture analysis findings
#problems       → Issues and violations
#suggestions    → AI-generated suggestions
```

The current routing scheme is simple and effective. No changes needed.

### View ↔ Data Dependencies

| View          | Sourcevision Data       | Rex Data    | Server APIs Used        |
|---------------|------------------------|-------------|------------------------|
| Overview      | manifest, inventory    | —           | /data/*                |
| Tasks (PRD)   | —                      | prd.json    | /data/prd.json, /api/rex/* |
| Import Graph  | imports, inventory     | —           | /data/*                |
| Zones         | zones, imports         | —           | /data/*                |
| Files         | inventory, zones       | —           | /data/*                |
| Routes        | components, inventory  | —           | /data/*                |
| Architecture  | zones (enriched)       | —           | /data/*                |
| Problems      | zones (enriched)       | —           | /data/*                |
| Suggestions   | zones (enriched)       | —           | /data/*                |

## Shared Component Library

Components are organized by abstraction level. The current codebase already has most of these; this section formalizes the taxonomy.

### Directory Structure

```
src/viewer/
├── main.ts                          # App root, routing, global state
├── types.ts                         # ViewId, DetailItem, LoadedData, NavigateTo
├── loader.ts                        # Data fetching, polling, validation
├── utils.ts                         # Zone colors, meter classes, flow helpers
├── constants.ts                     # Theme colors, enrichment thresholds
├── schema-compat.ts                 # Schema versioning
│
├── components/                      # Shared component library
│   ├── sidebar.ts                   # Main navigation sidebar
│   ├── detail-panel.ts              # Sliding detail panel (right side)
│   ├── theme-toggle.ts              # Dark/light mode toggle
│   ├── guide.ts                     # Per-view help overlay
│   │
│   ├── data-display/                # Read-only data presentation
│   │   ├── tree-view.ts             # Generic recursive tree renderer
│   │   ├── collapsible-section.ts   # Expandable section with threshold
│   │   ├── findings-list.ts         # Formatted issue listings
│   │   ├── mini-charts.ts           # Bar charts, spark lines
│   │   ├── health-gauge.ts          # Metric gauges
│   │   └── zone-map.ts             # Zone architecture diagram
│   │
│   ├── search-filter.ts             # Reusable search/filter input
│   │
│   └── prd-tree/                    # PRD-specific components
│       ├── index.ts                 # Re-exports
│       ├── types.ts                 # PRD types (mirrors Rex schema)
│       ├── compute.ts               # Pure stat computation functions
│       ├── prd-tree.ts              # Hierarchical tree renderer
│       └── task-detail.ts           # Task edit panel
│
├── views/                           # Full-page view components
│   ├── overview.ts                  # Dashboard
│   ├── prd.ts                       # PRD tree view
│   ├── graph.ts                     # Import graph (D3)
│   ├── zones.ts                     # Zone visualization
│   ├── files.ts                     # File listing
│   ├── routes.ts                    # Routes/components
│   ├── architecture.ts              # Architecture findings
│   ├── problems.ts                  # Issues
│   └── suggestions.ts              # Suggestions
│
├── graph/                           # D3 graph rendering internals
│   ├── renderer.ts
│   └── physics.ts
│
└── styles/                          # Modular CSS
    ├── index.css                    # Import manifest
    ├── tokens.css                   # Design tokens (CSS variables)
    ├── base.css                     # Global resets, typography
    ├── layout.css                   # Sidebar/main/detail grid
    ├── cards.css                    # Card components
    ├── forms.css                    # Inputs, buttons, selects
    ├── components.css               # Component-specific styles
    ├── tables.css                   # Data tables
    ├── detail.css                   # Detail panel styles
    ├── graph.css                    # D3 graph styles
    ├── routes.css                   # Routes view
    ├── zone-map.css                 # Zone visualization
    ├── overview.css                 # Overview dashboard
    ├── prd-tree.css                 # PRD tree and task detail
    ├── utils.css                    # Utility classes
    ├── a11y.css                     # Accessibility (sr-only, focus)
    └── responsive.css               # Mobile breakpoints
```

### Component Catalog

#### Layout Components (shared across all views)

| Component       | File                    | Purpose                              |
|----------------|-------------------------|--------------------------------------|
| `Sidebar`      | `components/sidebar.ts` | Navigation with section grouping     |
| `DetailPanel`  | `components/detail-panel.ts` | Sliding panel for item details  |
| `ThemeToggle`  | `components/theme-toggle.ts` | Dark/light mode switch          |
| `Guide`        | `components/guide.ts`   | Per-view help overlay                |

#### Data Display Components (reused by multiple views)

| Component           | File                               | Used By                   |
|---------------------|------------------------------------|---------------------------|
| `TreeView`          | `components/data-display/tree-view.ts` | Files, Routes        |
| `CollapsibleSection`| `components/data-display/collapsible-section.ts` | Architecture, Problems |
| `FindingsList`      | `components/data-display/findings-list.ts` | Architecture, Problems, Suggestions |
| `MiniCharts`        | `components/data-display/mini-charts.ts` | Overview              |
| `HealthGauge`       | `components/data-display/health-gauge.ts` | Overview              |
| `ZoneMap`           | `components/data-display/zone-map.ts` | Zones                 |
| `SearchFilter`      | `components/search-filter.ts`      | Files, Graph               |

#### PRD Components (task management)

| Component       | File                              | Purpose                              |
|----------------|-----------------------------------|--------------------------------------|
| `PRDTree`      | `components/prd-tree/prd-tree.ts` | Full PRD hierarchy tree renderer     |
| `TaskDetail`   | `components/prd-tree/task-detail.ts` | Task edit panel with status/priority/tags |
| `StatusIndicator` | `components/prd-tree/prd-tree.ts` | Status icon (●○◐◌⊘)             |
| `PriorityBadge`| `components/prd-tree/prd-tree.ts` | Priority label (critical/high/medium/low) |
| `ProgressBar`  | `components/prd-tree/prd-tree.ts` | Completion percentage bar            |
| `SummaryBar`   | `components/prd-tree/prd-tree.ts` | Status distribution stacked bar      |

### Shared Patterns

All components follow these conventions:

- **Functional Preact components** with hooks (`useState`, `useEffect`, `useCallback`, `useMemo`)
- **Props-based composition** — no Context API, no global state library
- **`h()` calls** — not JSX (consistent with current codebase)
- **CSS class naming** — BEM-like (`component__element--modifier`)
- **CSS variables** from `tokens.css` for all colors, spacing, sizes
- **Dark/light theming** via `[data-theme]` attribute on `<html>`
- **Accessibility** — semantic HTML, ARIA labels, keyboard navigation, focus management

## Data Architecture

### Data Flow

```
                    ┌─────────────────────┐
                    │ .sourcevision/*.json │
                    │ .rex/prd.json       │
                    └─────────┬───────────┘
                              │ fs.readFile / fs.writeFile
                              ▼
                    ┌─────────────────────┐
                    │ Server Routes       │
                    │ routes-data.ts      │ ← serves raw JSON files
                    │ routes-sv.ts        │ ← read-only SV API
                    │ routes-rex.ts       │ ← CRUD for PRD items
                    └─────────┬───────────┘
                              │ HTTP responses
                              ▼
                    ┌─────────────────────┐
                    │ loader.ts           │ ← fetches, validates, caches
                    │ (sourcevision data) │
                    │                     │
                    │ prd.ts fetch()      │ ← fetches PRD data directly
                    │ (rex data)          │
                    └─────────┬───────────┘
                              │ setData() / setState()
                              ▼
                    ┌─────────────────────┐
                    │ App (main.ts)       │ ← top-level state owner
                    │   data: LoadedData  │ ← sourcevision data
                    │   view: ViewId      │ ← current route
                    │   detail: DetailItem│ ← selected item for panel
                    └─────────┬───────────┘
                              │ props
                              ▼
                    ┌─────────────────────┐
                    │ Views               │ ← each view gets relevant
                    │   <PRDView />       │   data slices via props
                    │   <Overview />      │
                    │   <Graph />         │
                    │   ...               │
                    └─────────────────────┘
```

### State Management

State is managed at two levels:

1. **App-level** (`main.ts`) — Global data, current view, detail panel, theme
2. **View-level** — Local UI state (expanded nodes, selected items, filter text)

This is deliberate: no state management library is needed. The data model is simple (5 JSON files + 1 PRD document), and the app's interactive surface is moderate.

### Real-Time Updates

The server already supports two real-time mechanisms:

1. **Polling** (5-second interval via `loader.ts`): Fetches `/data/status`, compares mtimes, reloads on change
2. **WebSocket** (available but not yet consumed by viewer): Broadcasts `sv:data-changed`, `rex:prd-changed`, `rex:item-updated`

The migration path is straightforward: replace polling with WebSocket listeners for lower latency. The WebSocket manager already exists; the viewer just needs to connect.

### Type Strategy

The viewer maintains its own type definitions that mirror Rex's canonical types:

```
Rex (canonical)                    Viewer (local copy)
─────────────────                  ─────────────────────
packages/rex/src/schema/v1.ts      packages/sourcevision/src/viewer/components/prd-tree/types.ts
  PRDItem                            PRDItemData
  PRDDocument                        PRDDocumentData
  ItemLevel                          ItemLevel
  ItemStatus                         ItemStatus
  Priority                           Priority
  BranchStats                        BranchStats
```

**Why duplicate?** To avoid a build-time dependency between packages. The viewer is bundled into a single HTML file by esbuild; importing from `@n-dx/rex` would require the Rex package at build time and bloat the bundle with Node.js-only code. The types are stable and small enough that manual synchronization is manageable.

**When types diverge**: The `source` field exists in Rex's `PRDItem` but not in the viewer's `PRDItemData`. The viewer's type uses `PRDItemData` (with `Data` suffix) to signal it's not the canonical type. The viewer should only add fields it actually renders.

## Server Architecture

### Route Priority (unchanged)

```
1. /api/sv/*     → Sourcevision API (read-only)
2. /api/rex/*    → Rex API (CRUD + WebSocket broadcast)
3. /data/*       → Raw data files + status endpoint
4. /             → Viewer HTML (single file with inlined JS/CSS)
```

### Rex API Endpoints (existing)

| Method | Path                | Purpose                        |
|--------|---------------------|--------------------------------|
| GET    | `/api/rex/prd`      | Full PRD document              |
| GET    | `/api/rex/stats`    | Aggregated status counts       |
| GET    | `/api/rex/next`     | Next actionable task           |
| GET    | `/api/rex/items/:id`| Single item by ID              |
| PATCH  | `/api/rex/items/:id`| Update item fields             |
| GET    | `/api/rex/log`      | Execution log entries          |

These are sufficient for current PRD management. Future endpoints can be added incrementally (e.g., `POST /api/rex/items` for creating items, `DELETE /api/rex/items/:id` for removal).

## Styling Architecture

### Design Tokens

All visual values are defined as CSS custom properties in `tokens.css`:

```css
/* Brand */
--brand-navy, --brand-teal, --brand-purple, --brand-rose, --brand-green, --brand-orange

/* Layout */
--sidebar-w: 220px
--panel-w: 320px

/* Semantic (theme-dependent) */
--bg, --bg-surface, --bg-hover
--border
--text, --text-dim
--accent, --accent-dim
--green, --orange, --red, --purple
```

Both dark and light themes are defined via `[data-theme]` selectors. Theme preference persists in `localStorage` under `sv-theme`.

### CSS Module Organization

Styles are split into 16 focused files, imported via `styles/index.css`. Each file owns styles for a specific concern. New views or components should either extend an existing file or add a new one to the import list.

## Build Pipeline

```
src/viewer/main.ts     ─┐
                        ├─→ esbuild bundle ─→ JS string
src/viewer/styles/     ─┘                     CSS string
                                                │
src/viewer/index.html ──────────────────────────┤
                                                ▼
                                        dist/viewer/index.html
                                        (single self-contained file)
```

The build inlines all JS and CSS into the HTML template. This produces a single file that can be served by the Node.js server or opened directly from the filesystem (static/drag-drop mode).

## Migration Plan for Component Organization

The current component layout is already close to the target. The main organizational change is introducing a `data-display/` subdirectory to group the read-only visualization components:

### Step 1: Move data-display components (non-breaking)

```
components/tree-view.ts           → components/data-display/tree-view.ts
components/collapsible-section.ts → components/data-display/collapsible-section.ts
components/findings-list.ts       → components/data-display/findings-list.ts
components/mini-charts.ts         → components/data-display/mini-charts.ts
components/health-gauge.ts        → components/data-display/health-gauge.ts
components/zone-map.ts            → components/data-display/zone-map.ts
```

Update import paths in views that reference these components.

### Step 2: Update sidebar branding

Change the sidebar header from "SourceVision" to "n-dx" to reflect the unified nature of the dashboard. The analysis progress indicator stays — it still shows sourcevision module completion.

### Step 3: Add section separators in sidebar

Add visual grouping to the nav items list. The "Tasks" view (PRD) is already second in the nav, which gives it prominence. Adding a subtle section label above the analysis-specific views (Architecture, Problems, Suggestions) that require enrichment passes would help users understand the gating.

### Step 4: WebSocket upgrade (optional, performance)

Replace polling in `loader.ts` with WebSocket connection for real-time updates. The server infrastructure already exists.

## Future Considerations

### Adding New Views

To add a new view:

1. Create `views/new-view.ts` implementing the standard view pattern
2. Add the `ViewId` to the union type in `types.ts`
3. Add a nav entry in `sidebar.ts` with icon and label
4. Add a `case` in `renderView()` in `main.ts`
5. Add styles in a new or existing CSS file
6. Update the route validation set in `main.ts`

### Hench Integration

The hench agent has no viewer integration yet. Future views could show:
- Active agent runs with real-time streaming
- Run history with expandable transcripts
- Cost/token tracking dashboards

These would require new server routes (`/api/hench/*`) and data sources from `.hench/runs/`.

### Cross-View Navigation

The existing `navigateTo` function supports passing context (`{ file, zone }`) between views. This pattern extends naturally — a PRD task could link to the files it touches (via sourcevision data), and a file detail could show which PRD tasks reference it.

### Mobile Support

The current responsive CSS handles mobile layout (collapsible sidebar, stacked detail panel). The architecture doesn't need changes for mobile — it's already handled at the CSS level.
