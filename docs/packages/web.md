# Web Dashboard

`@n-dx/web` provides a browser-based project dashboard and unified MCP HTTP server.

## Features

- **Plan as tiles** — after the capture bar, Plan lays out tiles: Product map (full width), Inbox, Open changes, Plan health and Specs to tighten. Open changes carries two tabs: **List** (the Changes view) and **Tree** (the PRD tree, with Sidecar ghost rows). Select a tile to open it full-screen in place, with the detail panel beside it; **Open ↗** goes to the tile's own page. On a v1 project a Tasks tile stands in for the v2 tiles.
- **Plan's glance panels** — the lifecycle strip and the open-changes glance read one fast summary route, `GET /api/rex/changes/summary`, so they load on large PRDs; the product area map reads `GET /api/rex/product`.
  - **Lifecycle strip.** Under the capture bar, five counts in rex's change stages. Each count is a link to the list it counts, with a one-line hint under it saying what the stage holds: Inbox opens the Inbox page, the rest open Open changes filtered to that stage. Proposed is the pending pile: placed changes not yet started.
    - **Inbox** — changes awaiting placement.
    - **Proposed** — placed changes that are not yet Ready.
    - **Ready** — rex's `ready` flag: the change has an automated or metric requirement and no open blocker. A change becomes Ready by gaining such a requirement and clearing its blockers. At 0 the strip says "needs an automated requirement" (`rex ready` sets the flag).
    - **In progress** — work has started.
    - **Awaiting apply** — completed, but a steward has not yet applied its amendments to the product layer.

    After the counts, **Next** shows rex's next pick: its title and why rex chose it, linking to Work with it selected. The strip never starts a run. On v1 it shows Pending and In progress only.
  - **Product area map.** Full width under the strip: one block per area, sized by capability count and tinted by computed status (Met, Changing, Proposed, Defective; defective outranks the rest). A count marks the open changes that touch or amend the area or one of its capabilities, or add a capability under it; the server works the count out, counting each change once. The badge reads `N open`; selecting it opens Open changes filtered to that area (`?area=<slug>`), while the rest of the block opens the area view. A one-line key under the map names what block size, tint and `N open` mean. A block opens that area's view in the tile's full-screen and names `/product/area/<slug>` in the address bar; Esc or the trail returns to Plan where it was. Loaded directly, `/product/area/<slug>` shows the area view as the Product page. Past 12 areas, the smallest fold into one `+N smaller areas` block.
  - **Area view.** One area's spec map, at `/product/area/<slug>` (the area's frozen v2 slug), so it can be linked and reloaded. Open it by selecting a block on the Product area map, or load the address directly, which shows it as the Product page. The server computes every count and list: `GET /api/rex/product/area/<slug>`.
    - **Header.** The area's summary; counts of capabilities, constraints, met, changing, defective and open changes; a steward chip (`no steward` when none); **+ Change in this area** and **Open on Product page**.
    - **Constraint bands.** One band under the header for each constraint that binds the area.
    - **Spec map.** One block per capability, sized by its criteria count (a thin spec looks thin), tinted by computed status and marked with the open changes on it. Changing and defective capabilities come first, then larger specs. The blocks are the same component as the area map's.
    - **Four cards** beside the map: *Moving now* (the open changes the map badge counts, with **Open in Open changes** for the filtered list), *Waiting in the Inbox* (Inbox changes whose best placement guess is here, each with **Place**), *Recently applied* (the last five) and *Where it lives in code* (files the capabilities list, or an empty state with **Link code from the last analysis**). Each card has an empty state.
    - **Selecting a capability** swaps the cards for its detail in place: statement, criteria, pending amendments and history. The address becomes `/product/area/<slug>/capability/<id>`; Esc or the back button steps back to the cards, and Esc again returns to Plan. A capability the area does not list clears the selection.
    - **+ Change in this area** opens the capture with its placement shortlist limited to the area's capabilities and the constraints binding it (`rex add --area=<id|slug>`). **Add & place** writes the change already placed; with nothing chosen it lands in the Inbox.
  - **Open-changes glance.** On the Open changes tile: placed open changes grouped by planned release (newest first, Unscheduled last), each with a progress bar, a stage chip and at most one gap chip — **Blocked**, else **No criteria**. A change with no tasks is not a gap on v2; it runs as its own unit. The glance shows 12 rows, then `N more`, which opens Open changes.
- **Plan health** — replaces the Validation preview on the Plan page. It shows the last `GET /api/rex/validate` result as lights (Cycles, Orphans, Unresolved dependencies, and on v2 Stale release plans), each green, warning or failing with its count, plus when the check ran. **Check** reruns it; **Fix…** and **Reshape…** preview before they write; **Open** goes to the Validation view. Unresolved dependencies counts `blockedBy` references to an unknown id; duplicate ids and self-references stay in the DAG integrity check. Stale release plans is rex's own rule (open changes planned for a release that has shipped or been passed), so it matches `rex validate` and MCP `health`.
- **Specs to tighten** — a v2 tile that counts gaps in what the changes say, one row per gap, each linking to the Open changes list filtered to it; rows at zero are hidden. Rows: changes with no acceptance criteria, changes whose tasks have none, changes waiting on a blocker, and amendments awaiting review. A requirement-coverage row counts open changes with no automated or metric requirement on the change or its open tasks — the change-layer nodes `rex ready` evaluates on v2, so product-layer requirements do not count. It appears once one such requirement exists; until then one line says why Ready reads 0 and links the Product page's Requirements tab. Counts come from `GET /api/rex/changes/summary`.
- **Apply from the dashboard** — a change that is completed but not applied shows **Apply…** in its detail panel, and the lifecycle strip's Awaiting apply count opens the list of them. Apply previews each amendment's effect on the product map first, then writes on confirm, through the same rex core as MCP `apply_change` (`POST /api/rex/changes/:id/apply/preview` and `/apply`). The preview carries a hash of the change's amends and the specs of its targets; if either moved before you confirm, apply refuses and asks for a fresh preview.
- **SourceVision zone maps** — interactive visualization of architectural zones
- **PRD** — the product's requirements and the changes being made to them (see [The PRD](/guide/concepts/)). The **Product** page lists each capability with its computed status and health and the open changes against it, highlighting *revised* and *defective* rows; the **Changes** page groups changes by planned release and stage (see [The Changes page](#the-changes-page-v2)). Both pages appear in the navigation on a v2 project. On a v1 project (one that has not yet run `ndx migrate`), the PRD page shows the v1 item tree (epics, features, tasks) with completion stats
- **Unified MCP server** — single HTTP endpoint serving both Rex and SourceVision MCP tools
- **Live reload** — updates automatically when data changes (via `ndx refresh`)

## Usage

```sh
ndx start .                 # foreground on port 3117
ndx start --port=8080 .     # custom port
ndx start --background .    # daemon mode
ndx start status .          # check if running
ndx start stop .            # stop daemon
ndx dev .                   # dev mode with live reload
```

## Architecture

The web package has four internal zones forming a hub topology:

```
  web-server          (Express routes, gateways, MCP handlers)
       ↓                    ↓ (serves static assets only)
  web-viewer          (Preact UI hub — components, hooks, views)
       ↑ ↓                  ↓
  viewer-message-pipeline  (messaging middleware)
       ↓                    ↓
  web-shared          (framework-agnostic utilities)
```

- **web-server** — composition root; wires gateways and routes but doesn't import web-viewer at runtime (viewer is built separately and served as static assets)
- **web-viewer** — the hub; imports from messaging pipeline and web-shared
- **viewer-message-pipeline** — coalescer, throttle, rate-limiter, request-dedup
- **web-shared** — data-file constants, view identifiers; zero framework dependencies

See [Web Zone Governance](/contributing/web-zone-governance) for internal governance details.

## MCP Endpoints

The server exposes MCP over Streamable HTTP:

- `http://127.0.0.1:3117/mcp/rex` — Rex MCP tools
- `http://127.0.0.1:3117/mcp/sourcevision` — SourceVision MCP tools

See [MCP Integration](/guide/mcp) for setup instructions.

## PRD item routes

`PATCH /api/rex/items/:id` accepts only these fields: `status`, `failureReason`, `priority`, `tags`, `title`, `description`, `acceptanceCriteria` and `requirements`. Any other key (including `run`) is a `400` naming it. The update runs inside the PRD lock for the request's workspace and answers `409` when another process holds it. Saved run settings are written through `PUT /api/hench/prep/:taskId` (below), MCP `edit_item`, or `rex update --run` — not this route.

## The Changes page (v2)

The page is a planning view: open work leads and applied history stays folded away.

- **Order.** Releases run newest first by semver, so `0.10.0` sits above `0.9.0` and a prerelease such as `1.0.0-rc.1` sits below `1.0.0`. A leading `v` is ignored when comparing. The **Unscheduled** group (changes with no planned release, or a blank one) leads while it holds open work, and drops to the bottom once everything in it is applied. Within a release, open stages come first in lifecycle order and applied or shipped stages last.
- **Filters.** Chips along the top show a count each: **Open** (the default), **Applied**, and one per release. Open lists only open changes. Applied lists only groups that hold applied changes. A release chip shows that release's changes, open and applied. The choice is kept in the browser (`ndx.changes.filter`); a release that no longer exists falls back to Open.
- **Area filter.** `?area=<slug>` lists only the open changes the Product area map counts on that area (the server's per-area `openChangeIds`, so the list, the map badge and the Product page total agree). A removable chip names the area; removing it shows every open change. The filter lives in the address, not in browser storage, and outranks the remembered chip. An area with nothing open, or an unknown slug, shows an empty list under its slug.
- **Applied history.** Each group folds its applied changes behind an "N applied" toggle. No rows are rendered until it is expanded, so a group with over a thousand applied changes costs one button.
- **Descriptions.** A change's description shows two lines. **more** expands it and **less** folds it back.

## Finding and placing an Inbox change (v2)

On a v2 project a change with no place on the product map waits in the Inbox, and `ndx work` skips its tasks until it is placed. The dashboard lists these changes and places them without leaving the page.

**Find them.**

- **Plan.** An Inbox tile sits beside Open changes, below the capture bar and the full-width Product map tile, and is always present. Its badge shows the open count. It lists open changes awaiting placement, strongest rex match first, weak and tied guesses last. It shows five rows and links to the rest (`N more · Open ↗`). At zero the tile keeps its place and reads "Inbox is empty".
- **Counts.** The open count shows on the Plan tab and the bottom bar. It counts only open changes that need placement.
- **Applied history.** Changes applied before they were placed (migrated history) show as a collapsed line ("N applied changes were never placed") under the list. Expanding it lists each with its title, applied date and best guess. Open one to place it: the panel offers **touches** only, with a note, and Place & next walks that list. Amends is not offered, because the change's amendments have already reached the map.
- **Tasks tree.** In the Tree tab of Open changes, an Inbox change carries an **Inbox** badge, and the **In the Inbox** facet filters the tree to them.
- **Changes page.** An open change awaiting placement is tagged **Needs placement**; selecting the tag opens it.

**Place one.** A row, badge or tag opens the change's detail panel. Its **Where it goes** section shows rex's shortlist, each entry with a strength and its reasons.

1. Pick a candidate, or search capabilities and constraints.
2. Choose the relation: **Touches**, or **Amends** with a criteria edit or a replacement statement.
3. **Place** writes it. **Place & next** moves to the next Inbox change in the section's order. **Place & add another** adds a further touched place to the same change, for umbrella changes.
4. If nothing fits, **Nothing fits** opens a form that proposes a new capability or constraint under an area.

**Draft with the model.** When the `rex.placementDraft` feature toggle is on (default off), the placement form shows **Draft with the model**. It asks the `prd.place` model to pick a shortlist target, or to draft a new capability or constraint (title, area, statement and, for a capability only, criteria) and fills the form with the result. Each press spends tokens on one LLM call, so the toggle is enforced on the server too: with it off the draft route refuses. A draft never writes. Review the form, then press **Place** or **Propose**. See [Feature Toggles](/guide/configuration#feature-toggles).

**Place at capture.** The capture Preview lists rex's shortlist for each new change as a choice, with strength, area and a Touches or Amends relation. The top pick is pre-selected only when it is strong and untied; otherwise the default is **Leave it in the Inbox**. The primary button names what Add will do: **Add to Inbox**, **Add 1 change & place it** (**Add N changes & place M** for several), or **Add & amend…**, which opens the change's placement form on Amends once it is added. Most new changes never enter the Inbox.

**Clear a backlog.** **Open ↗** on the Inbox tile, or the bottom-bar Inbox pill, opens the full Inbox page: the queue on the left in the section's order, the change's **Where it goes** section on the right. The breadcrumb counts changes still to place and changes placed this visit. **Place & next** is the default action. Shortcuts are inactive while typing in a field, with a modifier held, or while a dialog is open:

| Key | Action |
|-----|--------|
| `J` / `K` | Next / previous change (wraps) |
| `1`–`5` | Pick a candidate |
| `T` / `A` | Relation: Touches / Amends |
| `Enter` | Place & next (Place or Propose when the form is in that mode) |
| `S` | Skip |
| `N` | Nothing fits |
| `/` | Search capabilities and constraints |

**Place on the map.** Every **Place** (an Inbox tile row, the Inbox page's **Place on the map ↗**, the area view's *Waiting in the Inbox* card) opens placement mode at `/product/place/<changeId>`: the spec map beside a wide "Where it goes" panel. The change detail panel keeps its compact 320px version, with a **Place on the map** switch. The breadcrumb reads "Placing N of M · title".

- **Where it starts.** A strong, untied top pick zooms straight into its area with that block lit. Any other shortlist (possible, weak, tied, empty or unreadable) opens at the area level with each area's candidate count; a note says why, including "rex found no candidate" and "Could not read rex's shortlist". Choosing an area zooms in.
- **Candidate cards.** The panel has one card per candidate: strength, reasons, area. A card lights its block, and a block selects its card; a block off the shortlist becomes the panel's pick. Candidates in other areas show as chips above the zoomed map and as cards; picking one moves the map. Switching to another candidate clears the previous target's criteria edits, so each target starts from its own criteria. Off-list blocks dim, except those sharing words with the change, marked `near`.
- **Touches or amends.** rex's relation is pre-selected only for a strong, untied pick; otherwise the card asks whether the change alters what the capability promises. **Touches** writes at once. **Amends** is edited in the card (criteria or a replacement statement); each edit is re-checked by rex's read-only `POST /api/rex/changes/:id/placement/check`, and the card shows the same dry-run line as the Sidecar's placement card. **Place** waits for an accepted check, and for the target's criteria to load. The target's block shows the criteria count the amendment would leave ("12 → 13").
- **Nothing fits.** Swaps the card for the proposal form and draws a dashed ghost block, titled as the form is, in the area the form names. A map pick of another area moves the form, and its ghost, there; choosing an area in the form moves the map back. The ghost goes when the form closes.
- **Place & next, Place & add another.** **Place & next** opens the next Inbox change in placement mode, strongest first, and its own shortlist decides where its map starts. **Place & add another** keeps the panel open for an umbrella change; every home placed in the visit is marked on the map. Writes use the existing `/place` and `/propose` routes.
- **Keys.** The Inbox page's keys work on the panel (table above): `J`/`K` and `S` open another change (after a plain Place, `J` lands on the change that took its slot), and `1`–`5`, `T`/`A`, `N`, `/` and `Enter` press the panel's controls.
- **Drafts.** Leaving (Esc, the breadcrumb, another tab) with a pick or an edit keeps it as a draft for the browser session, one per change. The Inbox row says "draft · …", and **Place** resumes it at the step it was left with. Esc with no edits just leaves. A draft never reaches the PRD, and is dropped once the change is placed.

Nothing is placed automatically. Every write goes through the placement routes below. Until a change is placed, the panel's **+ Add Task** carries a note that the task won't run.

## Inbox placement routes (v2)

On a v2 project a change captured without a home waits in the Inbox. Three routes
read and settle it. Rex decides everything (`suggestPlacement`, `recordPlacement`,
`recordProposal`, `recordUnplacement`); the server enriches the shortlist and writes through rex's v2
transaction, the execution log and the `rex:prd-changed` broadcast. A v1 tree
answers `409`, an unknown change `404`, any other rex refusal `422 { error, kind }`,
and a held PRD lock `409` naming its PID.

| Route | Answers |
|-------|---------|
| `GET /api/rex/changes/:id/placement` | `{ layout: "v2", change, relation, tied, shortlist }`. Each shortlist entry carries `target`, `type`, `title`, `area`, `statement`, `criteria`, `score`, `strength` (`strong`/`possible`/`weak`) and `reasons`. |
| `POST /api/rex/changes/:id/place` | Places the change on a capability or constraint (`touches` or `amends`): `{ change, target, relation, warnings? }`. |
| `POST /api/rex/changes/:id/propose` | Records a new capability or constraint when nothing fits: `{ change, proposed: { target, under, title, type }, warnings? }`. |
| `POST /api/rex/changes/:id/unplace` | Takes back one `touches` (`{ target }`) through rex's `recordUnplacement`: `{ change, target }`. A change left with no home returns to the Inbox. A cancelled change answers `422 change-not-open`, a target it does not touch `422 not-touched`. |

`POST /api/rex/items` on v2 also accepts `touches`, so a change captured with a
home skips the Inbox.

`GET /api/status` adds `rex.inbox: { open, appliedUnplaced }` on a v2 tree and
omits it on v1. `open` counts open changes awaiting placement (the ones
`ndx work` refuses); `appliedUnplaced` counts applied changes still flagged
`needsPlacement`, which are history and never placeable. Change rows from
`GET /api/rex/changes` carry `awaitsPlacement` for open held changes.
`GET /api/rex/changes/placements` returns every awaiting change's shortlist in one request, keyed by change id; a change whose shortlist cannot be built gets `{ error }`.

## Tune tiles: Outcomes by tier and Your tooling

Two read-only tiles on the Tune page. Neither writes anything.

**Outcomes by tier.** The gate pass rate per vendor and tier: the share of gated runs whose test gate passed.

- **Window.** The last 30 days. The tile states the start date.
- **Runs on this machine.** It reads hench run records from disk, across every worktree of this checkout still present. Records are machine-local, so runs made elsewhere, and runs in worktrees since removed, are not counted.
- **Keyed on vendor and tier.** Never on model name, since models are renamed and retired. A row's tooltip lists the resolved models for audit.
- **No gate result.** A run with no gate result stays out of the rate and is counted separately ("N runs without a gate result, not in the rate"). A row with no gated run shows `–`, not 0%.

**Your tooling.** A summary of what this project can run on: connected vendor CLIs, the model for each tier, review pairing and per-command route overrides. Editing stays in Settings. Vendor, tier and review lines link to the matching section of Settings › Robot Wrangler. No Settings field edits `llm.routes`, so the route line names `ndx config` instead of linking. The tile never runs a credential check, because the check sends a real prompt to the vendor CLI. It shows the result of the last check from Robot Wrangler when one exists. Otherwise it shows the vendor's catalog state.

## Sidecar on Plan and Tune

With `web.sidecar` on, Plan and Tune offer the Sidecar drawer as a second way to do what they already do. With it off, none of the entry points below render and every Plan and Tune element works as before.

**Entry points.**

| Where | Control | Opens |
|---|---|---|
| Capture bar, beside Preview | **Plan with Sidecar** | The Plan lens with the typed text, which goes as the session's first turn. Scoped to the area when the capture was. If the open session cannot take the turn, a new one starts or the drawer says why. |
| Area view | (attaches itself) | An `area` page item, with Explain by default. **Plan in this area** switches to the Plan lens aimed at that area. Closing the view or opening another area drops the Plan lens. |
| Inbox change | **Place with Sidecar** (replaces **Draft with the model**) | The Place lens on that change, with its placement card. |
| Specs to tighten | **Tighten with Sidecar** | The Describe lens on the change. |
| Open changes rows | **Describe in Sidecar** | The Describe lens on the change. |
| Tune, Runs tile | **Diagnose in Sidecar** on a task's newest failed run | The Diagnose run lens on that task. |

On Tune, the run classifier's verdict chip on a failed run shows whether or not the Sidecar is on. Your tooling also lists the Sidecar's vendor, model, mode and caps and each connection's sign-in state; Spend carries the Sidecar's own bucket.

**One placement surface.** One place decides a change's placement at a time. While the drawer holds that change's placement card, the placement panel shrinks to one line, "Placing with Sidecar · decide in the drawer", and the spec map follows the card's selected row, both ways. **Place by hand** reopens the panel with the card's selection. It also covers the card's withdrawal after 60 seconds.

**Ghost items.** While a change-set card waits, its items show wherever a change appears: the PRD tree, Open changes rows, markers on the area map and the area view's spec map, and a "+N waiting on a card" note in the lifecycle strip. Real counts never include them.

**Without the Sidecar.** Everything above is hidden. Plan keeps Preview, Draft with the model and the placement panel; Specs to tighten still links to the filtered list; the Tune tiles keep working.

## Prepare task

The Prepare task modal shows every per-task `ndx work` option before a run
starts: hench's resolved value for each, the key that supplied it, the
refusals a run would hit, the equivalent terminal command and a brief preview.

A change can be for this run or for the task, and the two are separate buttons:

- **Execute** runs the task now with the edits, and nothing is written to the
  PRD.
- **Save** writes the settings onto the PRD item, where `ndx work` reads them
  from a terminal too. "Run it differently once" and "this is how this task
  should be run" are different intentions; a single button would make every
  experiment permanent.

**What Save writes.** The fields that differ from the project default. A field
equal to the default is omitted rather than frozen, so a later change to
`llm.*` or `hench.*` still reaches the task. Launch-time options (`fresh`,
`allowDirty`) are never saved — they describe how one run starts. The two
model fields are the exception to "rebuild from what is shown": a saved block
is vendor-agnostic and may later be run under another vendor, so an untouched
model keeps its saved `tier` and per-vendor `models` exactly as they were (the
same for `reviewTier` / `reviewModels`), and only a model the reader chose is
written as a pin for today's vendor (`models: {"claude": "…"}`), replacing the
tier for that field; pins for other vendors are carried through untouched.
Notes for the agent have no project default: the field starts on the task's
saved notes, they are kept through any save, and emptying the field is what
drops them. A chosen reviewer is saved whenever a review would run, whether
the task or the config turns review on.

**Sources.** A field the task supplies reads "saved on task", with the project
default beside it ("project default: claude-sonnet from llm.claude.model"), so
the reader can see what the saved value displaced.

**Reset to defaults** clears the edits first. With nothing but saved settings
left it asks before clearing the block ("Clear 2 saved settings for this
task?"), because another session may be relying on it.

**Conflicts.** Each save carries the version the modal loaded. A save made
against a read someone else has overtaken is refused, and the modal shows
"These settings were saved elsewhere since you opened this." with **Reload**
(take the server's values, drop the edits) and **Overwrite** (resend the same
write — a clear included — against the version the refusal named).

**Off the anchor** the footer says "Saved on branch `<name>`; lands when the
branch merges" — saving from a branch worktree is allowed, and writes that
worktree's PRD.

**Footer** counts the two facts separately: how many changes apply to this run
only, and how many settings are saved and apply from the terminal too. The
**Ready to run** list marks a task carrying saved settings with a labelled dot,
so it is visible before the modal is opened.

### `PUT /api/hench/prep/:taskId`

Saves or clears a task's run settings.

```jsonc
// request
{ "run": { "tier": "heavy", "review": true }, "version": "a1b2c3d4e5f6" }
// 200
{ "saved": { "tier": "heavy", "review": true }, "version": "9f8e7d6c5b4a",
  "workspace": { "key": null, "branch": "main", "isAnchor": true } }
```

- `run` is the whole block; `null` or `{}` clears it. Keys, types and bounds
  are checked by rex's own `validateRunSettings`, so what the dashboard accepts
  cannot drift from what the store and `ndx work` accept. A launch-time key is
  a `400` naming it, as is an unknown key or an out-of-range value. A model or
  provider the active vendor cannot serve is refused before it is saved.
- `version` is a fingerprint of the block as the client last read it —
  `"none"` for a task carrying nothing — reported by `GET /api/hench/prep/:taskId`
  as `savedVersion`. It is re-read and compared **inside** the write
  transaction, so nothing can land between the read it compares against and the
  write it guards. A stale version answers `409` with `{conflict: true, saved,
  version}`; resending with that version is the overwrite. It is a fingerprint
  of the settings rather than the item's `lastModified`, so renaming a task
  does not invalidate a version the renamer never touched.
- The write runs inside `store.withTransaction` for **the request's
  workspace** (`/w/<key>/` or `X-Ndx-Workspace`), taking that worktree's PRD
  lock and rewriting that worktree's tree alone. A lock it cannot acquire is a
  `409` naming the holder's PID.
- A missing task is `404`, a container (an epic or feature on a v1 PRD) is a `400` — only
  tasks and subtasks carry run settings — and a workspace with no PRD is `404`.
  A foreign-site request is refused before anything is written.

`GET /api/hench/ready` rows carry `saved: boolean` for the same state.

## Static Export

```sh
ndx export .                        # export to ./ndx-export/ (gitignored)
ndx export --out-dir=./build .      # custom output directory
ndx export --deploy=github .        # deploy to GitHub Pages — confirms first
ndx export --deploy=github --yes .  # unattended deploy (CI)
```

Generates a static, self-contained dashboard that can be hosted anywhere.

**What is published.** PRD items (titles, descriptions, acceptance criteria, status), SourceVision analysis data (inventory, import graph, zones), and hench run *summaries* (status, token usage, files changed).

**What is not published.** Agent transcripts — hench `toolCalls` inputs and outputs, `events`, and `error` bodies — are stripped from every exported run by default, because they contain whatever the agent read or printed (`.env` contents, `process.env`, fixture data). Pass `--include-transcripts` to publish them deliberately; the static Task Audit view then shows them, otherwise it says the transcript was not included.

`--deploy=github` force-pushes to `origin/n-dx-dashboard`. It prints a manifest (remote, branch, run count, PRD item count, transcript inclusion) and asks for confirmation; when stdin is not a TTY it stops before writing or pushing unless `--yes` is passed. The dashboard's Export panel sends `--yes` only from its own confirmation step.
