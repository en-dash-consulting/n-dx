# Viewer Architecture

How the n-dx dashboard decides which views exist, what they are called, where they sit, and how a URL resolves to one. All of it lives in `packages/web`; the domain packages contribute data and route handlers, not navigation.

## One navigation model

A view is declared in one place, and everything that shows or routes to it reads from there.

| Concern | File | What it holds |
|---------|------|---------------|
| Which views exist | `packages/web/src/shared/view-id.ts` | The `ViewId` union |
| What a view is called | `packages/web/src/viewer/views/view-meta.ts` | `VIEW_META`: one entry per `ViewId` with `label`, `glyph`, `product` (`sourcevision`, `rex`, `hench` or `global`) and `blurb` |
| Where a view sits | `packages/web/src/viewer/views/stages.ts` | `STAGES`, `STAGE_ORDER`, `SETTINGS_ENTRIES`, `LIVE_VIEWS` |
| Which URLs resolve to it | `packages/web/src/shared/view-routing.ts` | Scope view lists, `buildValidViews`, `VIEW_ALIASES`, `resolveViewAlias` |
| How it renders | `packages/web/src/viewer/views/view-registry.ts` | `ViewId` to render function |

Rules that follow:

- `VIEW_META` is `as const satisfies Record<ViewId, ViewMeta>`. A missing or misspelt view is a compile error, and lookups stay narrow, so `stageProduct` in `stages.ts` returns `VIEW_META[stage].product` typed as one of the three package products.
- Labels are unique across views (`navigation-model.test.ts` fails otherwise). A label may contain `{cli}`, which callers resolve with `resolveCliLabel`. Accessors: `viewMeta`, `viewLabel`, `viewBlurb`, `viewGlyph`, `viewProduct`, `viewProductLabel`. `PRODUCT_LABELS` gives the display name per product.
- `stages.ts` re-exports `view-meta.ts`, so callers need one import. Both files are pure data and functions with no Preact. Components reach them through `packages/web/src/viewer/api.ts`.
- The top nav, stage pages, Home cards, breadcrumb, `document.title`, guide and settings overlay all read the model. Renaming a view is an edit to `VIEW_META` and nowhere else.

## Stages

The dashboard is a loop of three stages, `STAGE_ORDER = ["analyze", "plan", "work"]`. Each stage is itself a `ViewId` and a page that composes existing views as sections. A section is a window onto a view that keeps its own route; its "Open" link goes to that page.

`STAGES[stage].sections` is a list of `StageSection`. A section names only a `view`; its heading and blurb are that view's `VIEW_META` entry. Optional fields:

| Field | Effect |
|-------|--------|
| `plain` | Lead section, rendered in the page with no header and never collapsible. One per stage, first |
| `open`, `collapsedOnLoad` | Initial state. `collapsedOnLoad` ignores remembered state |
| `tabs` | Further views sharing the section as tabs (`StageTab`; `hiddenWhenDeployed` drops a server-built tab from static exports) |
| `group` | `{ heading, blurb }` for a tab group with no page of its own. Only Terrain uses it |
| `scroll`, `fill` | Bounded scroll region with an Expand control; full-height body for views that size themselves |
| `featureGate` | Hidden when the toggle is off (same keys as `useFeatureToggle`) |
| `requiresServer` | Absent from a static export |

Current composition:

- **Analyze:** `overview` (plain); Terrain (`graph` with tabs `iso-map` and `zones`); `files`; `problems`; `suggestions`; `architecture` (tab `routes`); `pr-markdown` (gate `sourcevision.prMarkdown`); `ask` (gate `sourcevision.ask`, requires server).
- **Plan:** `analysis` (plain); `prd`; `command-reference`; `hench-runs`; `merge-graph`; `validation`; `requirements`.
- **Work:** `rex-dashboard` (plain); `activity`; `token-usage`; `hench-audit`; `hench-optimization`; `hench-adaptive`; `workspaces` (requires server).

Each view is listed by at most one stage. Lookups in `stages.ts`:

- `stageForView(view, validViews?)` returns the owning stage, or null for home, settings, Live and unlisted views.
- `visibleStages(validViews)` returns the stages that have a page in the current scope.
- `isStageId`, `stageProduct` and `STAGE_ORDER` support the loop.

`packages/web/src/viewer/views/stage-pages.ts` exports `StagePage` and `HomeView`. It mounts a section's view only while the section is open, and receives the view renderer as a parameter to avoid a cycle with the registry.

### Home

`HomeView` is the landing page. It shows a card per visible stage with headline numbers from the project status, and a next-step panel with four states.

### Settings entries

`SETTINGS_ENTRIES` lists the settings views in order: `robot-wrangler`, `project`, `workflow`, `commands`. `isSettingsView(view)` tests membership. They belong to no stage.

### Live views

`LIVE_VIEWS` is `live`, `live-task`, `live-analyze`; `isLiveView(view)` tests membership. Live is not a stage: it is absent from `STAGE_ORDER`, so the stage links never step into it. Paths are `/live`, `/live/task/<id>` and `/live/analyze`. A `live-task` with no id normalises to `live` (`normalizeLiveView` in `route-state.ts`). The views are `views/live.ts`, `live-task.ts` and `live-analyze.ts`, fed by `GET /api/live`.

## Shell components

All in `packages/web/src/viewer/components/`:

| Component | File | Role |
|-----------|------|------|
| `TopNav` | `top-nav.ts` | Brand (also the way home), the three stage tabs, a divider, the Live tab, search. A stage tab is lit on its own page and on any view the stage lists |
| Live tab | `live-tab.ts` | Idle, running and attention states, with a peek of what is running |
| `StageLinks` | `stage-links.ts` | Edge buttons stepping around the loop. Hidden when a scoped viewer has a single stage |
| `Breadcrumb` | `breadcrumb.ts` | "project > stage > view", and `document.title`. Behind the hub it adds a Hub link and a project switcher (`project-switcher.ts`) |
| `BottomBar` | `bottom-bar.ts` | Server identity, settings cog, per-stage status indicators, theme, help, and the Commands button |
| `SettingsOverlay` | `settings-overlay.ts` | Full overlay listing `SETTINGS_ENTRIES` filtered by `validViews` |
| `CommandsSheet` | `commands-sheet.ts` | Sheet that lifts over the page and renders `command-reference` |

## Routing

URLs are paths (`/zones`, `/hench-runs/<id>`). `parsePathnameRoute` in `packages/web/src/viewer/route-state.ts` parses them against the viewer's `validViews`, and `viewPathname` is the inverse. Hash routes go through `parseLegacyHashRoute`. The viewer may be mounted under `/p/<id>` and `/w/<key>` prefixes, handled by `viewer/base-path.ts`.

### Redirect aliases

`VIEW_ALIASES` in `view-routing.ts` maps old top-level paths to the view that absorbed them:

| Old path | Target |
|----------|--------|
| `overview` | `analyze` |
| `rex-dashboard` | `work` |
| `llm-provider` | `robot-wrangler` |
| `hench-config`, `cli-timeouts`, `hench-templates` | `workflow` |
| `project-settings`, `feature-toggles`, `notion-config`, `integrations` | `project` |

`resolveViewAlias(segment, validViews)` returns the target only if the target is itself in `validViews`, else null. That is the scoped-viewer case: `overview` and `rex-dashboard` remain registered `ViewId`s, so a rex-scoped viewer, which has no `work` stage, serves `rex-dashboard` as its own page instead of redirecting nowhere.

The alias is applied in two places that must agree:

- **Server:** `packages/web/src/server/routes-static.ts` answers with a 302 before the SPA catch-all, using `buildValidViews(ctx.scope ?? null)`. Sub-path and query survive. The Location is relative so a `/w/<key>/` slot is kept. It is 302 rather than 301 because the same localhost URL may later be a differently scoped viewer.
- **Viewer:** `parsePathnameRoute` calls `resolveViewAlias` before its literal view check, so a client-side load of an old path lands on the new view. A separate `resolveLegacyViewAlias` in `route-state.ts` maps `rex-dashboard/token-usage` and similar paths to `token-usage`.

### Settings and the commands sheet

- **Settings are routes shown as an overlay.** `/robot-wrangler`, `/project`, `/workflow` and `/commands` are real routes. In `main.ts`, `settingsOpen = isSettingsView(view)` renders `SettingsOverlay` over the page. The page underneath stays mounted: `usePageEntry` tracks the last non-settings entry (home on a direct load), and closing navigates back to it. The bottom bar's cog navigates to `robot-wrangler`.
- **The commands sheet is UI state, not a route.** `main.ts` holds `commandsOpen`; the Commands button toggles it and any change of `view` closes it. The sheet renders `command-reference`, which also has its own page at `/command-reference`. The `commands` settings view is a separate page.

## Package-scoped viewers

`sourcevision serve` spawns the web CLI with `--scope=sourcevision` (`packages/sourcevision/src/cli/serve.ts`). `packages/web/src/cli/index.ts` accepts `--scope=` with `sourcevision`, `rex` or `hench`, and the server reports the scope on `GET /api/config`. The viewer fetches it before first render (`fetchBootConfig` in `main.ts`) and computes `validViews = buildValidViews(scope)`.

- **Unified dashboard** (no scope, or `all`): every view in `SOURCEVISION_SCOPE_VIEWS`, `REX_SCOPE_VIEWS`, `HENCH_SCOPE_VIEWS` and `CROSS_CUTTING_VIEWS`.
- **Scoped viewer:** that scope's list plus `CROSS_CUTTING_VIEWS` (`home`, the Live views, `workspaces`, `token-usage`, the settings views, `command-reference`). Each scope list includes its own stage page (`analyze`, `plan` or `work`) and no other.
- **Consequences:** the top nav and stage links show only stages in `validViews`; `stageForView` takes `validViews`, so a view whose stage is absent lights no stage; settings entries and bottom-bar indicators are filtered the same way. The server skips watchers and routes for out-of-scope packages (`isInScope` in `server/start.ts`).

Layering and barrel rules for `src/shared/` and the viewer are in `packages/web/AGENTS.md`.

## Tests that hold the contract

| Test | Covers |
|------|--------|
| `packages/web/tests/e2e-ui/navigation.spec.ts` | **Required test** (see `TESTING.md`). Deep-links every view in `VIEW_META` with no console errors, and checks each redirect alias lands on its target |
| `packages/web/tests/unit/viewer/navigation-model.test.ts` | `VIEW_META` coverage and completeness, unique labels, each view placed once, one lead section per stage, rendered surfaces (breadcrumb, `document.title`, top nav, Home, stage pages, settings overlay, guide) using the model's labels, and the Analysis stage composition |
| `packages/web/tests/unit/shared/view-routing.test.ts` | Scope view lists, Live views in every scope, and alias resolution including the rex-scoped `rex-dashboard` exception |
| `packages/web/tests/unit/viewer/navigation-a11y.test.ts` | Keyboard and screen-reader access to the navigation surfaces (`pnpm --filter @n-dx/web test:a11y`) |
| `packages/web/tests/unit/viewer/shell.test.ts` | `stages.ts` ordering and registry coverage, `TopNav`, `StageLinks`, `StagePage` and `HomeView` |

## History

The original decision record (March 2026) chose a hybrid, "Option D": each domain package would export a data API and a static `ViewerDescriptor` (id, label, `apiPrefix`, a `nav` list, file watchers), and `packages/web` would compose the unified dashboard from those descriptors. The sidebar would be built from them, replacing the hardcoded `NAV_ENTRIES` table in `components/sidebar.ts`. It rejected three alternatives: packages shipping Preact components (A), iframes of standalone viewers (B), and web-only UI with no standalone mode (C).

Only part of that shipped. `ViewerDescriptor`, `NAV_ENTRIES` and `components/sidebar.ts` do not exist on main; the navigation model above replaced them, with `packages/web` owning all navigation metadata. What survived is the standalone mode: `--scope=<package>` makes `packages/web` the single viewer runtime for a scoped viewer, and the domain packages stay free of any UI framework.
