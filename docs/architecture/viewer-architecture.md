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
- The top nav, stage pages, Home cards, page titles, `document.title`, guide and settings overlay all read the model. Renaming a view is an edit to `VIEW_META` and nowhere else.

## Stages

The dashboard is a loop of three stages, `STAGE_ORDER = ["analyze", "plan", "work"]`. Each stage is itself a `ViewId` and a page that composes existing views as sections or tiles. A section is a window onto a view that keeps its own route; its "Open" link goes to that page.

`STAGES[stage].sections` is a list of `StageSection`. A section names only a `view`; its heading and blurb are that view's `VIEW_META` entry. Optional fields:

| Field | Effect |
|-------|--------|
| `plain` | Lead section, rendered in the page with no header and never collapsible. At most one per stage, first (Plan has none) |
| `open` | Expanded when the page first opens; the open state is remembered after that |
| `scroll`, `fill` | Bounded scroll region with an Expand control; full-height body for views that size themselves |
| `featureGate` | Hidden when the toggle is off (same keys as `useFeatureToggle`) |
| `requiresServer` | Absent from a static export |

A stage may instead be a dashboard: when `STAGES[stage].tiles` is set, the page renders its plain lead section, if it has one, and then a grid of `StageTile`s (`views/stage-tiles.ts`) in place of the other sections. A tile names a `view` (what it shows when opened), and may set:

| Field | Effect |
|-------|--------|
| `cols`, `rows` | Columns of 12 (4, 6, 8, 12; default 4) and fixed-height rows (1–3; default 1) the tile spans |
| `panel`, `title` | Render a stage panel (`renderPanel`: `map`, `glance`, `recommendations`, …) instead of the view, named by `title` |
| `panelTab` | Opened, the panel is a first tab of its own, named this, ahead of `view` and `tabs` |
| `chromeless` | The panel brings its own header and full-screen (the codebase map), so the tile draws none |
| `grow` | The tile spans whatever its content needs instead of clipping at `rows` (Plan's capture, whose preview opens beneath the input) |
| `tabs` | Further views shown as tabs when the tile is opened |
| `featureGate`, `requiresServer`, `hiddenWhenDeployed` | As for sections |

A stage may also split into **modes** (`STAGES[stage].modes`, a list of `StageMode`): the page draws a toggle under its head (`role="tablist"`, one button per mode with its `label` and the question it answers, `focus`) and the active mode's tiles beneath it. A mode with a `view` is addressed by that route, so the toggle navigates: `/work` opens Work on Now and `/tune` opens it on Tune, and `tune` lights the Work tab. A mode without one is remembered per stage in `localStorage` (`ndx.stage-mode`). A mode no tile of which this viewer can show is not offered.

The grid has twelve columns and fixed-height rows; a tile spans `cols` × `rows` of it (defaults 4 × 1) and dense packing fills the column beside a tall tile. A tile shows `renderSummary(tile)` (Spend, on Work's Tune mode), else its panel, else its view cut to the tile. A tile has two modes: closed, and opened by its header as a modal over the page — inset on a dimmed backdrop, holding the whole view with the tile's tabs under a "← Stage / Tile" trail; the backdrop, the trail, Esc and the close button close it. The modal stops short of the detail panel when one is open. `alsoOwns` lists views a stage owns without placing them (they still light the stage's top-bar tab).

Current composition:

- **Analyze (tiles):** lead `overview` (its `lead` variant: analysis line and controls). Top row, 6 × 2 each: `glance` ("Codebase at a glance", view `zones`, panel tab then tabs `files`, `architecture`, `routes`: only visuals and numbers — the health and infrastructure stat cards, totals, languages as a pie, largest zones with a "!" on those with issues, files by role) and `recommendations` ("Recommended fixes", view `suggestions`: one list of next steps, readiness gaps, problems, suggestions, architecture findings and files to move, each with its fix and "+ PRD", built by the pure `buildRecommendations` in `views/action-items.ts`). On the page, Avg cohesion, Avg coupling, SDLC readiness, Cross-zone imports and each "!" zone highlight the fixes they concern on hover and filter the list to them on click; the list's chip clears the filter. Inside the opened visuals tile the cards lead to the sections that explain them instead. Then `map` (12 × 3, chromeless, `iso-map`, dropped in static exports) and `ask` (6 wide, gate `sourcevision.ask`, requires server). `AnalyzeActionsProvider` (`views/analyze-actions-context.ts`) shares the recommendations, the filter and the hovered item: the map puts a "!" on every zone with issues, lights a hovered item's zones, and notes beside itself an item it cannot draw or whose remedy adds files. Each item's "+ PRD" (and the opened tiles' "Add all") posts to `/api/rex/capture-recommendations`: one Inbox change per item on v2, skipping titles the PRD holds. Owns `graph`, `problems` and `suggestions` off-page.
A stage may also list **side panels** (`STAGES[stage].sidePanels`, a list of `StageSidePanel`), the same in every mode: vertical tabs in a sticky column beside the page — in the page's own flow, so they stay inside the main column, clear of the stage links and of the Sidecar drawer — each a disclosure button that slides a 560px panel in over the page (`views/stage-side-panels.ts`). A panel renders its `panel` through the registry, opened, or its `view`; it is an `aria-modal` dialog that keeps focus inside it, with a heading, a one-line blurb and "Open ↗" to its view, and closes on Esc, its close button or the scrim, returning focus to what opened it. A `badge` counts on the tab; `v2Only` panels wait for the layout. Panels marked `transitional` are parts of the page the redesign has no place for yet, kept rather than removed, listed after a divider. `sideAction` puts a head button that opens one panel ("Add to the plan"). A side panel places no view: what it shows belongs to its stage through a tile or `alsoOwns`, or to another stage.

- **Plan (two modes):** no lead section.
  - *Create — how, why and what:* the glance band (panel `plan-glance`, v2: what you are working on, the highest-priority open change, and the release being planned, from Plan's change summary and `GET /api/rex/people`), then Product areas (panel `plan-areas`, view `product`, 12 × 3, `grow`, v2: For me / Everyone and a chip per stage over one box per area of the product map with the open changes moving it, and a box for open changes no area counts; boxes in a row share one height, a box opens its area on a click or Enter, a summary shows three lines at most). A v1 project draws Tasks and Product instead. There is no lifecycle counts band.
  - *Preparation — who and when:* the full `changes` list (titled Assign and schedule, 12 × 3, tab `prd` = Tree): each open change with its assignee picker, release and priority. A v1 project draws Tasks, whose detail panel assigns and prioritises.
  - Head: Solo / Team and "Take the tour" (`views/plan-tour.ts`: four spotlighted steps), then "Add to the plan". Scope, stage focus and mode are one shared view (`views/plan-view-state.ts`): scope and mode remembered per browser, the stage focus not.
  - Side panels: New change (panel `capture`: the whole Add Items form; it and the Add Items page share one draft, text and images, through `CaptureDraftProvider` in `main.ts` above the router; the head's "Add to the plan" opens it), From analysis (panel `recommendations`: Analysis's recommended fixes, each with "+ PRD"), Inbox (v2, with its count: `views/plan-inbox.ts`, under For me / Everyone, each row draggable onto an area and offering "Plan in <area>", both a `touches` placement through `views/plan-placement.ts`; the panel slides aside while a row is dragged), then, transitional, Open changes, Plan health and Specs to tighten.
  - Owns `requirements`, `analysis`, `inbox` and `validation` off-page: Requirements is a tab of Product, and the rest show in side panels; their routes still open them.
- **Work (two modes):** no lead section.
  - *Now — who is working on what, and what is next* (`/work`): Running now (panel `running`: every live task run from `GET /api/live`, with who the task is assigned to, the agent's vendor and model, the worktree, and elapsed time and tokens against a typical run), Ready to run (panel `up-next`: `ReadyToRun`, the queue `ndx work` picks from, under one line giving a typical run, split into the tasks assigned to you and the unassigned ones grouped by product area — by the top of the chain on v1 — with a count of those assigned to someone else; each row shows its assignee, and its own estimate only when its tier has one), then Statistics (panel `work-stats`, view `rex-dashboard`: the totals, overall progress, status breakdown, priority distribution and structure health; no change progress). Estimates are the median duration, tokens and cost of the last 30 days' finished runs, per tier, from `GET /api/hench/estimates` (`server/run-estimates.ts`).
  - *Tune — how the agent runs* (`/tune`): Agent settings (panel `agent-settings`, 12 wide, requires server: the model per tier and what each is used for, the agent's rules — allowed commands and git subcommands, blocked paths, project skills, the test gate, review mode and spend caps — and the agent prompt file, each editable in place through the same endpoints as Settings and linking to the page that holds the rest; a save on either side makes the other re-read, `views/settings-sync.ts`), then `hench-runs` (Runs, 8 × 2, tab `activity` = Execution Log), `token-usage` (titled Spend), `hench-audit` (Audit, 8 × 2), `hench-optimization` (titled Suggestions, tab `hench-adaptive`), `merge-graph` (titled Shipped) and Outcomes by tier. Tile titles override view labels because labels are unique.
  - Side panel, transitional: PRD tools (the Rex dashboard's quick actions: browse, validate, reorganize, restore).
- **Settings › Workspaces:** the worktree list behind a dropdown that expands it (`views/settings-disclosure.ts`), remembered per browser.

Moved views keep their ids and routes. `command-reference` (All Commands) is the Reference tab of Settings › Commands; the alias `/command-reference` lands on `/commands/reference` (`VIEW_ALIASES`, `VIEW_ALIAS_SUBPATH` in `view-routing.ts`). Robot Wrangler and Workflow stay in the Settings overlay.

Each view is listed by at most one stage. Lookups in `stages.ts`:

- `stageForView(view, validViews?)` returns the owning stage, or null for home, settings, Live and unlisted views.
- `visibleStages(validViews)` returns the stages that have a page in the current scope.
- `stageViews(stage)` lists every view a stage names: sections, tiles and their tabs, and `alsoOwns`.
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
| `TopNav` | `top-nav.ts` | Brand (also the way home), the three stage tabs (Analysis, Plan, Work), a divider, the Live tab, search. A stage tab is lit on its own page and on any view the stage lists |
| Live tab | `live-tab.ts` | Idle, running and attention states, with a peek of what is running |
| `StageLinks` | `stage-links.ts` | Edge buttons stepping around the loop. Hidden when a scoped viewer has a single stage |
| `ProjectContext` | `project-context.ts` | In the top bar: the project name (a project switcher behind a hub with several, `project-switcher.ts`), a Hub link behind the hub, the worktree · branch chip (`workspace-switcher.ts`), and `document.title` |
| `PageTitle` | `page-title.ts` | The glyph, name and blurb of a view's own page; none on stage pages, Home or Live |
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
- **The commands sheet is UI state, not a route.** `main.ts` holds `commandsOpen`; the Commands button toggles it and any change of `view` closes it. The sheet renders `command-reference`, whose own page is `/commands/reference` (`/command-reference` redirects there). The `commands` settings view is a separate page.

## Package-scoped viewers

`sourcevision serve` spawns the web CLI with `--scope=sourcevision` (`packages/sourcevision/src/cli/serve.ts`). `packages/web/src/cli/index.ts` accepts `--scope=` with `sourcevision`, `rex` or `hench`, and the server reports the scope on `GET /api/config`. The viewer fetches it before first render (`fetchBootConfig` in `main.ts`) and computes `validViews = buildValidViews(scope)`.

- **Unified dashboard** (no scope, or `all`): every view in `SOURCEVISION_SCOPE_VIEWS`, `REX_SCOPE_VIEWS`, `HENCH_SCOPE_VIEWS` and `CROSS_CUTTING_VIEWS`.
- **Scoped viewer:** that scope's list plus `CROSS_CUTTING_VIEWS` (`home`, the Live views, `workspaces`, `token-usage`, the settings views, `command-reference`). Each scope list includes its own stage page (`analyze`, `plan` or `work`); hench's also lists `tune`, Work's second mode. A Rex viewer has no Work stage, so the PRD Graph and Execution Log open there as pages of their own, lit under no stage.
- **Consequences:** the top nav and stage links show only stages in `validViews`; `stageForView` takes `validViews`, so a view whose stage is absent lights no stage; settings entries and bottom-bar indicators are filtered the same way. The server skips watchers and routes for out-of-scope packages (`isInScope` in `server/start.ts`).

Layering and barrel rules for `src/shared/` and the viewer are in `packages/web/AGENTS.md`.

## Tests that hold the contract

| Test | Covers |
|------|--------|
| `packages/web/tests/e2e-ui/navigation.spec.ts` | **Required test** (see `TESTING.md`). Deep-links every view in `VIEW_META` with no console errors, and checks each redirect alias lands on its target |
| `packages/web/tests/unit/viewer/navigation-model.test.ts` | `VIEW_META` coverage and completeness, unique labels, each view placed once, at most one lead section per stage, rendered surfaces (`document.title`, top nav, Home, stage pages, settings overlay, guide) using the model's labels, and the Analysis stage composition |
| `packages/web/tests/unit/shared/view-routing.test.ts` | Scope view lists, Live views in every scope, and alias resolution including the rex-scoped `rex-dashboard` exception |
| `packages/web/tests/unit/viewer/navigation-a11y.test.ts` | Keyboard and screen-reader access to the navigation surfaces (`pnpm --filter @n-dx/web test:a11y`) |
| `packages/web/tests/unit/viewer/shell.test.ts` | `stages.ts` ordering and registry coverage, `TopNav`, `StageLinks`, `StagePage` and `HomeView` |

## History

The original decision record (March 2026) chose a hybrid, "Option D": each domain package would export a data API and a static `ViewerDescriptor` (id, label, `apiPrefix`, a `nav` list, file watchers), and `packages/web` would compose the unified dashboard from those descriptors. The sidebar would be built from them, replacing the hardcoded `NAV_ENTRIES` table in `components/sidebar.ts`. It rejected three alternatives: packages shipping Preact components (A), iframes of standalone viewers (B), and web-only UI with no standalone mode (C).

Only part of that shipped. `ViewerDescriptor`, `NAV_ENTRIES` and `components/sidebar.ts` do not exist on main; the navigation model above replaced them, with `packages/web` owning all navigation metadata. What survived is the standalone mode: `--scope=<package>` makes `packages/web` the single viewer runtime for a scoped viewer, and the domain packages stay free of any UI framework.
