# Composable Viewer Architecture

Architecture decision for how sourcevision, rex, and hench expose standalone viewers while composing into the unified n-dx dashboard.

## Decision: Hybrid — Data APIs + Viewer Descriptors (Option D)

None of the three originally proposed options (A–C) fit cleanly. The chosen approach is a hybrid:

1. **Each package exports a data API** (route handlers) for its domain data.
2. **Each package exports a viewer descriptor** — a static manifest declaring its views, nav items, and data requirements — that `packages/web` uses to compose the unified dashboard.
3. **Each package ships an optional standalone viewer** via a `serve` command that renders only its own views (no iframe gymnastics, no duplicated UI framework).

This combines the best of options A and C while avoiding their downsides.

## Options Considered

### Option A: Packages export route handlers + HTML templates

Each package exports both data API routes and Preact view components that `packages/web` composes directly.

**Pros:**
- Maximum reuse — views defined once, composed by web
- Strong typing across package boundary

**Cons:**
- Creates a compile-time dependency from packages → preact/viewer infrastructure
- Sourcevision, rex, hench would all need preact + esbuild as dependencies
- Breaks the "independently installable" requirement — installing `sourcevision` alone shouldn't pull in a UI framework
- Couples package release cycles to the viewer framework

**Verdict:** Rejected. Coupling analysis/PRD tools to a UI framework violates package independence.

### Option B: Each package ships a standalone single-file viewer; web assembles via iframes/tabs

**Pros:**
- Perfect isolation — each package owns its entire viewer
- Zero coupling between viewers
- Works when packages are installed independently

**Cons:**
- Iframes create terrible UX: no shared navigation, no shared theme, no cross-view linking
- Massive code duplication: each package bundles its own sidebar, theme toggle, routing, CSS
- 3× the bundle size for the unified dashboard
- Cross-package features (token-usage spans hench data in rex context) become impossible or require postMessage hacks

**Verdict:** Rejected. The UX and maintenance costs are unacceptable.

### Option C: Packages only export data APIs; all UI lives in packages/web

**Pros:**
- Simplest mental model — UI lives in exactly one place
- No coupling from tool packages to UI concerns
- Natural home for cross-cutting views (token-usage, overview)

**Cons:**
- When a user installs only `sourcevision`, `sourcevision serve` has nothing to serve
- Forces users to install `@n-dx/web` for any visualization, even basic analysis results
- Doesn't satisfy the "independently installable and viewable" acceptance criterion

**Verdict:** Partially adopted. The UI *does* live in packages/web, but packages provide enough metadata for web to build standalone modes.

### Option D: Data APIs + Viewer Descriptors (chosen)

Each package exports:
1. **Route handlers** — HTTP API for its domain data (already exists)
2. **A viewer descriptor** — a static JSON-serializable manifest declaring views, navigation, and data shape
3. **No Preact/UI dependency** — the package doesn't ship view components

`packages/web` owns:
1. **All Preact UI code** — views, components, styles, build pipeline
2. **Composition logic** — reads viewer descriptors to decide what to render
3. **Standalone mode** — when invoked as `sourcevision serve`, renders only the sourcevision section

**Pros:**
- Packages stay lightweight — no UI framework dependency
- `sourcevision serve` works by delegating to `@n-dx/web` with `--scope=sourcevision`
- Unified dashboard composes all packages with shared navigation, theme, cross-linking
- Adding a new package's views means: add route handlers + descriptor, add views in packages/web
- Clear ownership: data logic in the domain package, presentation in packages/web

**Cons:**
- Viewer descriptor is a new concept to maintain
- View components in packages/web reference data shapes from the domain package (but this already exists via type copies with @see annotations)

**Verdict:** Adopted. Best balance of independence, composability, and UX.

## Contract

### 1. Viewer Descriptor

Each package that wants a viewer presence exports a `ViewerDescriptor` from its public API. This is a plain object — no UI code, no framework dependency.

```typescript
/**
 * Declares what a package contributes to the n-dx dashboard viewer.
 * Exported from each package's public API (e.g., sourcevision, rex, hench).
 */
interface ViewerDescriptor {
  /** Package identifier. Used as URL prefix and scope key. */
  id: string;

  /** Human-readable label for sidebar section header. */
  label: string;

  /** Path to product logo PNG (relative to package root, for build pipeline). */
  logo?: string;

  /** API route prefix this package claims (e.g., "/api/sv"). */
  apiPrefix: string;

  /** Navigation items to render in the sidebar. */
  nav: ViewerNavItem[];

  /** File watchers: directories/files the server should watch for changes. */
  watchers: ViewerWatcher[];

  /** Required data directory. If missing, this section is disabled. */
  dataDir?: string;
}

interface ViewerNavItem {
  /** View identifier — maps to a hash route (e.g., "graph" → #graph). */
  id: string;

  /** Display label in sidebar. */
  label: string;

  /** Icon character for sidebar. */
  icon: string;

  /** Minimum enrichment pass required (0 = always visible). */
  minPass?: number;
}

interface ViewerWatcher {
  /** Path relative to project root (e.g., ".sourcevision"). */
  dir: string;

  /** File glob or specific filename to watch. */
  pattern: string;

  /** WebSocket event type to broadcast on change. */
  event: string;
}
```

### 2. Route Handler Export

Each package exports its route handler for the web server to mount. The handler follows the existing pattern: a function that receives `(req, res, ctx)` and returns `boolean` (or `Promise<boolean>`).

```typescript
/**
 * Route handler that serves package-specific API endpoints.
 * Matches requests under its apiPrefix and returns true if handled.
 */
type PackageRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: (data: unknown) => void,
) => boolean | Promise<boolean>;
```

Each package exports this from its public API alongside the descriptor:

```typescript
// packages/sourcevision/src/public.ts
export { viewerDescriptor } from "./viewer/descriptor.js";
export { handleSourcevisionRoute } from "./viewer/routes.js";

// packages/rex/src/public.ts
export { viewerDescriptor } from "./viewer/descriptor.js";
export { handleRexRoute } from "./viewer/routes.js";

// packages/hench/src/public.ts (new)
export { viewerDescriptor } from "./viewer/descriptor.js";
export { handleHenchRoute } from "./viewer/routes.js";
```

### 3. Standalone Serve Mode

When a user runs `sourcevision serve`, the command delegates to `packages/web` with a scope parameter:

```
sourcevision serve [dir]
  → node packages/web/dist/cli/index.js serve --scope=sourcevision [dir]
```

The `--scope` flag tells `packages/web` to:
- Only register route handlers for the scoped package
- Only show navigation items from the scoped package's descriptor
- Skip file watchers for other packages
- Adjust the sidebar header/branding to match the scoped package

This means **packages/web is the single viewer runtime**. Domain packages never ship their own HTTP server or UI code — they contribute descriptors and route handlers that packages/web assembles.

### 4. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  packages/web  (single viewer runtime)                       │
│                                                              │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────┐          │
│  │ SV routes    │  │ Rex routes │  │ Hench routes │          │
│  │ (imported)   │  │ (imported) │  │ (imported)   │          │
│  └──────┬───────┘  └─────┬──────┘  └──────┬───────┘          │
│         │                │                │                  │
│         ▼                ▼                ▼                  │
│  ┌──────────────────────────────────────────────┐            │
│  │  HTTP Server (start.ts)                       │            │
│  │  - Mounts routes by descriptor.apiPrefix      │            │
│  │  - Sets up watchers by descriptor.watchers    │            │
│  │  - Filters by --scope if present              │            │
│  └──────────────────────────────────────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────┐            │
│  │  Preact Viewer (main.ts)                      │            │
│  │  - Builds sidebar from descriptors            │            │
│  │  - Routes views by descriptor nav items       │            │
│  │  - Shared theme, layout, cross-linking        │            │
│  └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
    .sourcevision/    .rex/          .hench/runs/
    (filesystem)     (filesystem)    (filesystem)
```

### 5. What Each Package Contributes

**sourcevision** exports:
```typescript
export const viewerDescriptor: ViewerDescriptor = {
  id: "sourcevision",
  label: "SOURCEVISION",
  logo: "SourceVision.png",
  apiPrefix: "/api/sv",
  dataDir: ".sourcevision",
  nav: [
    { id: "overview",     icon: "▣", label: "Overview" },
    { id: "graph",        icon: "⮕", label: "Import Graph" },
    { id: "zones",        icon: "⬢", label: "Zones" },
    { id: "files",        icon: "☰", label: "Files" },
    { id: "routes",       icon: "◇", label: "Routes" },
    { id: "architecture", icon: "◨", label: "Architecture", minPass: 2 },
    { id: "problems",     icon: "⚠", label: "Problems",     minPass: 2 },
    { id: "suggestions",  icon: "✨", label: "Suggestions",  minPass: 2 },
  ],
  watchers: [
    { dir: ".sourcevision", pattern: "*.json", event: "sv:data-changed" },
  ],
};
```

**rex** exports:
```typescript
export const viewerDescriptor: ViewerDescriptor = {
  id: "rex",
  label: "REX",
  logo: "Rex-F.png",
  apiPrefix: "/api/rex",
  dataDir: ".rex",
  nav: [
    { id: "rex-dashboard", icon: "▨", label: "Dashboard" },
    { id: "prd",           icon: "☑", label: "Tasks" },
    { id: "rex-analysis",  icon: "⚙", label: "Analysis" },
    { id: "validation",    icon: "✔", label: "Validation" },
    { id: "token-usage",   icon: "⊚", label: "Token Usage" },
  ],
  watchers: [
    { dir: ".rex", pattern: "prd.json", event: "rex:prd-changed" },
  ],
};
```

**hench** exports:
```typescript
export const viewerDescriptor: ViewerDescriptor = {
  id: "hench",
  label: "HENCH",
  logo: "Hench-F.png",
  apiPrefix: "/api/hench",
  dataDir: ".hench",
  nav: [
    { id: "hench-runs", icon: "▶", label: "Runs" },
  ],
  watchers: [
    { dir: ".hench/runs", pattern: "*.json", event: "hench:run-changed" },
  ],
};
```

### 6. How packages/web Composes

```typescript
// packages/web/src/server/start.ts (conceptual)

import { viewerDescriptor as svDescriptor, handleSourcevisionRoute } from "@n-dx/sourcevision";
import { viewerDescriptor as rexDescriptor, handleRexRoute } from "@n-dx/rex";
import { viewerDescriptor as henchDescriptor, handleHenchRoute } from "@n-dx/hench";

const ALL_PACKAGES = [
  { descriptor: svDescriptor,    handler: handleSourcevisionRoute },
  { descriptor: rexDescriptor,   handler: handleRexRoute },
  { descriptor: henchDescriptor, handler: handleHenchRoute },
];

function startServer(targetDir: string, port: number, opts: { scope?: string }) {
  // Filter packages by scope
  const packages = opts.scope
    ? ALL_PACKAGES.filter(p => p.descriptor.id === opts.scope)
    : ALL_PACKAGES;

  // Mount route handlers
  for (const { handler } of packages) {
    // register in request dispatch chain
  }

  // Set up file watchers from descriptors
  for (const { descriptor } of packages) {
    for (const watcher of descriptor.watchers) {
      watch(join(targetDir, watcher.dir), (_, filename) => {
        if (matchesPattern(filename, watcher.pattern)) {
          ws.broadcast({ type: watcher.event, file: filename, timestamp: new Date().toISOString() });
        }
      });
    }
  }

  // Pass descriptors to viewer for sidebar rendering
  // (injected as JSON into the HTML template at build time or served via /api/meta/descriptors)
}
```

### 7. Viewer-side Composition

The Preact viewer receives descriptors and uses them to build the sidebar dynamically:

```typescript
// packages/web/src/viewer/main.ts (conceptual)

// Descriptors loaded from /api/meta/descriptors or embedded in HTML
const descriptors = await fetch("/api/meta/descriptors").then(r => r.json());

// Build sidebar sections from descriptors
const sections = descriptors.map(d => ({
  label: d.label,
  product: d.id,
  items: d.nav.map(n => ({
    id: n.id,
    icon: n.icon,
    label: n.label,
    minPass: n.minPass ?? 0,
  })),
}));
```

The view components themselves (graph, prd, hench-runs, etc.) remain in packages/web. The descriptors don't carry UI code — they carry *metadata* that the existing UI code uses to determine what to show.

### 8. Cross-Cutting Views

Some views span multiple packages (e.g., token-usage aggregates hench run data but lives in the rex navigation section). These are handled naturally:

- The view component lives in packages/web (as all UI does)
- It fetches from multiple API prefixes (`/api/hench/runs` for raw data)
- The descriptor that declares it in navigation determines which section it appears in
- When running in `--scope=rex` mode, token-usage still appears and fetches hench data if available, gracefully degrading if `.hench/runs/` doesn't exist

### 9. Package Dependency Graph

```
                    @n-dx/web
                   /    |     \
          import  /     |      \  import
                 /      |       \
    @n-dx/sourcevision  |   @n-dx/hench
         (descriptor    |    (descriptor
          + routes)     |     + routes)
                        |
                   @n-dx/rex
                   (descriptor
                    + routes)
```

- `@n-dx/web` depends on all three packages (for descriptors + route handlers)
- Packages do NOT depend on `@n-dx/web` — the serve command delegates via subprocess
- Packages do NOT depend on preact, esbuild, or any UI framework
- Packages only export plain objects (descriptors) and functions (route handlers)

## Independently-Installable Validation

| Scenario | How it works |
|----------|-------------|
| User installs only `sourcevision` | `sourcevision serve` spawns `npx @n-dx/web serve --scope=sourcevision` (or fails gracefully if web isn't available, telling user to install it) |
| User installs only `rex` | `rex serve` spawns `npx @n-dx/web serve --scope=rex` |
| User installs full `n-dx` | `ndx web` spawns `@n-dx/web serve` with all scopes enabled |
| User adds a new tool package | Package exports descriptor + routes; add to ALL_PACKAGES in web |

When packages are independently installed without `@n-dx/web`, the `serve` command can:
- **Option 1:** Print a helpful message: "Install @n-dx/web for a visual dashboard: npm i @n-dx/web"
- **Option 2:** Use `npx @n-dx/web serve --scope=<pkg>` to auto-install and run (slower first time, zero friction)
- **Option 3:** Fall back to a minimal text-based summary printed to terminal

The recommended approach is Option 2 with a fallback to Option 3 — try npx, if it fails print a terminal summary.

## Migration Path

The current codebase is already close to this architecture. Migration steps:

1. **Define `ViewerDescriptor` type** in a shared location (packages/web/src/types/ or a tiny shared-types package)
2. **Create descriptor objects** in each package — extract from the hardcoded `NAV_ENTRIES` in sidebar.ts
3. **Move route handlers** from packages/web back to domain packages, behind the existing public API exports
4. **Update packages/web** to import descriptors + routes instead of hardcoding them
5. **Add `--scope` flag** to packages/web CLI
6. **Update `sourcevision serve`** stub to pass `--scope=sourcevision`
7. **Add `rex serve` and `hench serve`** commands that delegate similarly

Each step is independently shippable. The current system works throughout the migration.

## File Changes Summary

| Package | New/Changed Files | Purpose |
|---------|-------------------|---------|
| sourcevision | `src/viewer/descriptor.ts`, `src/viewer/routes.ts`, update `public.ts` | Export descriptor + route handler |
| rex | `src/viewer/descriptor.ts`, `src/viewer/routes.ts`, update `public.ts` | Export descriptor + route handler |
| hench | `src/viewer/descriptor.ts`, `src/viewer/routes.ts`, update `public.ts` | Export descriptor + route handler |
| web | `src/types/viewer-descriptor.ts` | Shared type definition |
| web | Update `start.ts` | Import descriptors, dynamic composition |
| web | Update `cli/index.ts` | Add `--scope` flag |
| web | Update viewer `sidebar.ts`, `main.ts` | Dynamic nav from descriptors |
