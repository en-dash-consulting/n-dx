# Web Dashboard

`@n-dx/web` provides a browser-based project dashboard and unified MCP HTTP server.

## Features

- **Plan** — Create opens on three cards: what you're working on (your change in progress, else your next one), the highest-priority open change, and what's next for the product (the release being planned, and rex's next pick). Under them, **How work moves**: Inbox → Proposed → Ready → In progress → Awaiting apply, each a button with its count (under For me / Everyone) and a line on what happens there, under "Click a stage to focus on it"; clicking one focuses the product areas and the Inbox panel on it (the Inbox stage empties the areas, a later stage empties the Inbox panel), and clicking it again or **Show all** clears it. Then **Product areas**: one box per area of the product map listing the open changes moving it, with stage, priority and assignee, and a box for open changes no area counts. Boxes in a row share one height; a box opens its area on a click anywhere outside its change titles (or Enter), and its summary shows three lines at most, fading the third, with the whole text as its tooltip. Above the boxes, **For me / Everyone** narrows them (and the Inbox panel) to your work, beside "Drag an Inbox item onto an area to plan it." Preparation is **Assign and schedule**, whose full-screen has **List** and **Tree** tabs. In the head, **Solo / Team** (remembered per browser) switches how the page reads — Solo names nobody and drops For me / Everyone — and **Take the tour** walks a newcomer through the cards, How work moves, the Inbox and the areas in four spotlighted steps (Skip, Back, Next; Esc closes). On a v1 project Tasks and Product stand in for the v2 tiles.
- **Planning from the Inbox** — in Plan's Inbox panel (titled **Your inbox** in Solo, with the design's hint for each mode, and "Nothing waiting on you. Nice." when empty) each row with a guessed area offers **Accept → `<area>`** in Team or **Plan in `<area>`** in Solo, and any row can be dragged onto a product-area box: the panel slides aside while you drag, and the box shows where to drop. Both record a `touches` placement on the best candidate in that area (`POST /api/rex/changes/:id/place`); a drop on an area the shortlist has no candidate in opens placement mode instead.
- **Side panels** — vertical tabs at the page's right edge slide a panel in over the page; Esc, the close button or the scrim closes it, returning focus to the tab, and **Open ↗** goes to its own page. Plan's are **New change** (the whole Add Items form — attachments, preview, batch import, project scan, history; the head's **Add to the plan** opens it, and its text and images are shared with the Add Items page), **From analysis** (the recommended fixes, each with **+ PRD**) and **Inbox** (with its count), then, after a divider, Open changes, Plan health and Specs to tighten, kept there while the redesign finds them a place. Work's is **PRD tools** (browse, validate, reorganize, restore).
- **Work** — Now shows Running now beside the **Run queue**, then **Statistics**: totals, overall progress, status breakdown, priority distribution and structure health in one section. Tune opens on **Ready to run**, split into the tasks assigned to you and the unassigned ones grouped by product area (by top-level section on v1), with a count of those assigned to someone else; each card's menu can add it to the run queue. Tune also has the **Audit** tile beside Runs.
- **Run queue** — tasks lined up, in order, for the agent to run next, on Work › Now and Plan › Preparation (one queue, saved in the hench directory as `run-queue.json`). Add a ready task from the panel's picker or from Ready to run, move items up and down, or remove them. Plain `ndx work` autoselection (no `--task`, `--epic`, `--tags` or `--mine`) takes the queue's first item that can run before its own pick and takes it off the queue; an item that will never run as it stands (finished or no longer in the PRD) is dropped with a note, and one that may run later (blocked or deferred, still in the Inbox, held by another worktree) is passed over and kept. `ndx work` and the dashboard both hold `run-queue.json.lock` around a change, so neither overwrites the other. A PRD that cannot be read stops the run before the queue is touched, and a dry run leaves the queue alone. Each save sends the order the panel last read; when the queue has changed since (another window, or a run took an item) the save is refused (`409`) and the panel shows the queue as it stands. **Workspaces** is a Settings page, behind a dropdown that expands the worktree list.
- **Plan's glance panels** — the glance cards, How work moves and the open-changes glance read one fast summary route, `GET /api/rex/changes/summary`, so they load on large PRDs; the product areas read `GET /api/rex/product`.
  - **How planning works.** Above the tiles on a v2 project, the planning process as five steps — Capture, Place, Ready, Work, Apply — each with one line saying what you do there and a link to where it is done (the capture tile's input row, the Inbox, Open changes filtered to Proposed or Awaiting apply, Work with the next pick selected). The step the project needs most is marked "Do this next", with a line saying why: changes awaiting apply first (under `rex.applyOn: release` the next `rex release` applies them, so they rank last and the line says they wait for it), then Inbox changes waiting for a place, then work — changes marked ready, work in progress, or rex's next pick (`ndx work` runs a Proposed change too, so Ready is informational) — and only then placed changes not marked ready, asking for an automated requirement while some open change has none and otherwise for `rex ready`; with nothing open, Capture.
  - **Stages.** The product areas' chips use rex's change stages:
    - **Proposed** — placed changes that are not yet Ready.
    - **Ready** — rex's `ready` flag: the change has an automated or metric requirement and no open blocker (`rex ready` sets the flag).
    - **In progress** — work has started.
    - **Awaiting apply** — completed, but a steward has not yet applied its amendments to the product layer.

    Changes awaiting placement are the Inbox, counted on its side-panel tab.
  - **Product area map.** In placement mode: one block per area, sized by capability count and tinted by computed status (Met, Changing, Proposed, Defective; defective outranks the rest). A count marks the open changes that touch or amend the area or one of its capabilities, or add a capability under it; the server works the count out, counting each change once and leaving out a shipped one, as the Open filter does. The badge reads `N open`; selecting it opens Open changes filtered to that area (`?area=<slug>`), while the rest of the block opens the area view. A one-line key under the map names what block size, tint and `N open` mean. A block opens that area's view in the tile's full-screen and names `/product/area/<slug>` in the address bar; Esc or the trail returns to Plan where it was. Loaded directly, `/product/area/<slug>` shows the area view as the Product page. Past 12 areas, the smallest fold into one `+N smaller areas` block.
  - **Area view.** One area's spec map, at `/product/area/<slug>` (the area's frozen v2 slug), so it can be linked and reloaded. Open it by selecting a block on the Product area map, or load the address directly, which shows it as the Product page. The server computes every count and list: `GET /api/rex/product/area/<slug>`.
    - **Header.** The area's summary; counts of capabilities, constraints, met, changing, defective and open changes; a steward chip (`no steward` when none); **+ Change in this area** and **Open on Product page**.
    - **Constraint bands.** One band under the header for each constraint that binds the area.
    - **Spec map.** One block per capability, sized by its criteria count (a thin spec looks thin), tinted by computed status and marked with the open changes on it. Changing and defective capabilities come first, then larger specs. The blocks are the same component as the area map's.
    - **Four cards** beside the map: *Moving now* (the open changes the map badge counts, with **Open in Open changes** for the filtered list), *Waiting in the Inbox* (Inbox changes whose best placement guess is here, each with **Place**), *Recently applied* (the last five) and *Where it lives in code* (files the capabilities list, or an empty state with **Link code from the last analysis**). Each card has an empty state.
    - **Selecting a capability** swaps the cards for its detail in place: statement, criteria, pending amendments and history. The address becomes `/product/area/<slug>/capability/<id>`; Esc or the back button steps back to the cards, and Esc again returns to Plan. A capability the area does not list clears the selection.
    - **+ Change in this area** opens the capture with its placement shortlist limited to the area's capabilities and the constraints binding it (`rex add --area=<id|slug>`). **Add & place** writes the change already placed; with nothing chosen it lands in the Inbox.
  - **Open-changes glance.** In the Open changes side panel: placed open changes grouped by planned release (newest first, Unscheduled last), each with a progress bar, a stage chip and at most one gap chip — **Blocked**, else **No criteria**. A change with no tasks is not a gap on v2; it runs as its own unit. The glance shows 12 rows, then `N more`, which opens Open changes.
- **Plan health** — replaces the Validation preview on the Plan page. It shows the last `GET /api/rex/validate` result as lights (Cycles, Orphans, Unresolved dependencies, and on v2 Stale release plans), each green, warning or failing with its count, plus when the check ran. **Check** reruns it; **Fix…** and **Reshape…** preview before they write; **Open** goes to the Validation view. Unresolved dependencies counts `blockedBy` references to an unknown id; duplicate ids and self-references stay in the DAG integrity check. Stale release plans is rex's own rule (open changes planned for a release that has shipped or been passed), so it matches `rex validate` and MCP `health`.
- **Specs to tighten** — a v2 side panel that counts gaps in what the changes say, one row per gap, each linking to the Open changes list filtered to it; rows at zero are hidden. Rows: changes with no acceptance criteria, changes whose tasks have none, changes waiting on a blocker, and amendments awaiting review. A requirement-coverage row counts open changes with no automated or metric requirement on the change or its open tasks — the change-layer nodes `rex ready` evaluates on v2, so product-layer requirements do not count. It appears once one such requirement exists; until then one line says why Ready reads 0 and links the Product page's Requirements tab. Counts come from `GET /api/rex/changes/summary`.
- **Apply from the dashboard** — a change that is completed but not applied shows **Apply…** in its detail panel, and the Awaiting apply chip over Plan's product areas focuses them on those changes. Apply previews each amendment's effect on the product map first, then writes on confirm, through the same rex core as MCP `apply_change` (`POST /api/rex/changes/:id/apply/preview` and `/apply`). The preview carries a hash of the change's amends and the specs of its targets; if either moved before you confirm, apply refuses and asks for a fresh preview.
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

- **Plan.** The Inbox is a side panel on Plan, its tab always present on v2 with the open count. It lists every open change awaiting placement, strongest rex match first, weak and tied guesses last, and **Open ↗** goes to the triage page. At zero it reads "Inbox is empty". It is a working surface: each row's best-guess button (**Accept → `<area>`** in Team, **Plan in `<area>`** in Solo, in place of the Inbox page's plain **Accept**) and **Place best guesses** take clicks in place.
- **Counts.** The open count shows on the Plan tab and the bottom bar. It counts only open changes that need placement.
- **Applied history.** Changes applied before they were placed (migrated history) show as a collapsed line ("N applied changes were never placed") under the list. Expanding it lists each with its title, applied date and best guess. Open one to place it: the panel offers **touches** only, with a note, and Place & next walks that list. Amends is not offered, because the change's amendments have already reached the map.
- **Tasks tree.** In the Tree tab of Open changes, an Inbox change carries an **Inbox** badge, and the **In the Inbox** facet filters the tree to them.
- **Changes page.** An open change awaiting placement is tagged **Needs placement**; selecting the tag opens it.

**Accept a guess.** A row with a best guess has **Accept**: one click places the change on that guess as **Touches**. A refusal shows under the row in rex's words.

**Place best guesses.** **Place best guesses (N)** above the list reviews every change that has a guess: each with its best guess, strength and a checkbox. Weak guesses (a word match and little more) start unticked. **Place N** records the ticked ones as **Touches** in one write (`POST /api/rex/changes/place-best`); a pair rex refuses is listed and the rest are placed. The write is then committed: one commit of exactly the PRD files it moved, with an `N-DX-Item` trailer per change, leaving anything else in the tree (staged or not) alone and never pushing. The result line gives the commit's sha, or why nothing was committed (not a git repository, a merge in progress); the placement stands either way. On the Plan tile the button opens the Inbox page with the review showing. Applied changes never placed are included, marked *applied*. Amending a spec is never done in bulk.

**Place one.** A row's **Place** opens the Inbox page on that change; a row, badge or tag opens its detail panel. Either way its **Where it goes** section shows rex's shortlist, each entry with a strength and its reasons.

1. Pick a candidate, or search capabilities and constraints.
2. Choose the relation. The form opens on **Touches**, even when rex's rules suggest Amends. **Amends** needs a criteria edit or a replacement statement: until it has one, the confirm button stays disabled and the form says so.
3. Check the preview, then press the confirm button. Once a target is picked, a preview draws the change, the relation and the target: Touches as a dashed edge, Amends as a solid heavy one. It shows why the target is there (rex's strength and reasons, the rule behind the relation, or that the pick was your own or the model's) and the target before and after: its statement and criteria unchanged for Touches, or changed as the amendment says for Amends. If another open change already amends the target, the Amends preview names it and warns that the first to apply wins. The preview redraws as the pick, relation or amendment changes, and writes nothing. The confirm button names the action, such as **Touch Refunds** or **Amend Refunds**; it reads **Place** until a target is picked. **Place & next** moves to the next Inbox change in the section's order. **Place & add another** adds a further touched place to the same change, for umbrella changes.
4. If nothing fits, **Nothing fits** opens a form that proposes a new capability or constraint under an area.

**Draft with the model.** When the `rex.placementDraft` feature toggle is on (default off), the placement form shows **Draft with the model**. It asks the `prd.place` model to pick a shortlist target, or to draft a new capability or constraint (title, area, statement and, for a capability only, criteria) and fills the form with the result. Each press spends tokens on one LLM call, so the toggle is enforced on the server too: with it off the draft route refuses. A draft never writes. Review the form, then press the confirm button (**Touch X** or **Amend X**) or **Propose**. See [Feature Toggles](/guide/configuration#feature-toggles).

**Place at capture.** The capture Preview lists rex's shortlist for each new change as a choice, with strength, area and a Touches or Amends relation. The top pick is pre-selected only when it is strong and untied; otherwise the default is **Leave it in the Inbox**. The primary button names what Add will do: **Add to Inbox**, **Add 1 change & place it** (**Add N changes & place M** for several), or **Add & amend…**, which opens the change's placement form on Amends once it is added. Most new changes never enter the Inbox.

**Clear a backlog.** The Inbox tile's header, its `N more · Open ↗`, or the bottom-bar Inbox pill opens the full Inbox page: the queue on the left in the section's order, the change's **Where it goes** section on the right. The breadcrumb counts changes still to place and changes placed this visit. **Place & next** is the default action. Shortcuts are inactive while typing in a field, with a modifier held, or while a dialog is open:

| Key | Action |
|-----|--------|
| `J` / `K` | Next / previous change (wraps) |
| `1`–`5` | Pick a candidate |
| `T` / `A` | Relation: Touches / Amends |
| `Enter` | Place & next (Place or Propose when the form is in that mode) |
| `S` | Skip |
| `N` | Nothing fits |
| `/` | Search capabilities and constraints |

**Place on the map.** The Inbox page's **Place on the map ↗** and the area view's *Waiting in the Inbox* card's **Place** open placement mode at `/product/place/<changeId>`: the spec map beside a wide "Where it goes" panel. The change detail panel keeps its compact 320px version, with a **Place on the map** switch. The breadcrumb reads "Placing N of M · title".

- **Where it starts.** A strong, untied top pick zooms straight into its area with that block lit. Any other shortlist (possible, weak, tied, empty or unreadable) opens at the area level with each area's candidate count; a note says why, including "rex found no candidate" and "Could not read rex's shortlist". Choosing an area zooms in.
- **Candidate cards.** The panel has one card per candidate: strength, reasons, area. A card lights its block, and a block selects its card; a block off the shortlist becomes the panel's pick. Candidates in other areas show as chips above the zoomed map and as cards; picking one moves the map. Switching to another candidate clears the previous target's criteria edits, so each target starts from its own criteria. Off-list blocks dim, except those sharing words with the change, marked `near`.
- **Touches or amends.** Touches is pre-selected for a strong, untied pick whose rules say Touches; Amends is never pre-selected. Otherwise the card asks whether the change alters what the capability promises. **Touches** writes at once. **Amends** is edited in the card (criteria or a replacement statement); each edit is re-checked by rex's read-only `POST /api/rex/changes/:id/placement/check`, and the card shows the same dry-run line as the Sidecar's placement card. The confirm button (**Touch X** or **Amend X**) waits for an accepted check, and for the target's criteria to load; the panel shows the same preview as the compact form. The target's block shows the criteria count the amendment would leave ("12 → 13").
- **Nothing fits.** Swaps the card for the proposal form and draws a dashed ghost block, titled as the form is, in the area the form names. A map pick of another area moves the form, and its ghost, there; choosing an area in the form moves the map back. The ghost goes when the form closes.
- **Place & next, Place & add another.** **Place & next** opens the next Inbox change in placement mode, strongest first, and its own shortlist decides where its map starts. **Place & add another** keeps the panel open for an umbrella change; every home placed in the visit is marked on the map. Writes use the existing `/place` and `/propose` routes.
- **Keys.** The Inbox page's keys work on the panel (table above): `J`/`K` and `S` open another change (after a plain Place, `J` lands on the change that took its slot), and `1`–`5`, `T`/`A`, `N`, `/` and `Enter` press the panel's controls.
- **Drafts.** Leaving (Esc, the breadcrumb, another tab) with a pick or an edit keeps it as a draft for the browser session, one per change. The Inbox row says "draft · …", and **Place** resumes it at the step it was left with. Esc with no edits just leaves. A draft never reaches the PRD, and is dropped once the change is placed.

**Moving an item from the Ask panel.** When the Ask panel proposes moving an item under a different parent, its proposal card draws the same kind of preview: the item, the parent it leaves, the parent it joins, and the proposal's rationale as the reason. The accept button names the move and the new parent, such as **Move to Checkout**; nothing is written until it is pressed. The Reorganize panel's proposed moves do not have this preview yet.

Nothing is placed without a click: **Accept** and **Place best guesses** write only what was shown. Every write goes through the placement routes below. Until a change is placed, the panel's **+ Add Task** carries a note that the task won't run.

## Inbox placement routes (v2)

On a v2 project a change captured without a home waits in the Inbox. These routes
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
| `POST /api/rex/changes/place-best` | Places each `{ change, target }` of `{ placements: [...] }` (at most 500) as a `touches`, in one transaction: `{ placed: [{ change, changeTitle, target, title }], refused: [{ change, target, error, kind }], commit }`. A refused pair is reported and skipped; the rest are written, each logged as `change_placed`, then committed: `commit` is `{ sha }`, or `{ skipped }` with the reason. Used by **Accept** and **Place best guesses**. |
| `POST /api/rex/changes/:id/unplace` | Takes back one `touches` (`{ target }`) through rex's `recordUnplacement`: `{ change, target }`. A change left with no home returns to the Inbox. A cancelled change answers `422 change-not-open`, a target it does not touch `422 not-touched`. |

`POST /api/rex/items` on v2 also accepts `touches`, so a change captured with a
home skips the Inbox.

`GET /api/status` adds `rex.inbox: { open, appliedUnplaced }` on a v2 tree and
omits it on v1. `open` counts every open change with `needsPlacement`, the
count `get_prd_status` reports, with or without a capability to place it on;
`appliedUnplaced` counts applied changes still flagged
`needsPlacement`, which are history and never placeable. Change rows from
`GET /api/rex/changes` carry `inbox` for those open Inbox changes and
`awaitsPlacement` for the held subset (the ones `ndx work` refuses).
`GET /api/rex/changes/placements` returns every awaiting change's shortlist in one request, keyed by change id; a change whose shortlist cannot be built gets `{ error }`.

### Assignees

Inbox rows, backlog rows on the Changes page and the change detail panel carry
an assignee picker; it writes the item's `assignee` (the field `ndx work --mine`
selects by) through `PATCH /api/rex/items/:id`, trimmed, with an empty value
removing it. `GET /api/rex/people` answers `{ me, people }`: `me` is rex's
`resolveActor` identity, and `people` are `me`, the git authors (`git shortlog
-sne HEAD`) and product stewards, one entry per email, a git author's id being
`Name <email>`. `me`'s spelling wins for its email, so picking yourself saves the
exact string `ndx work --mine` compares; a row assigned to your email under
another spelling is marked "not matched by ndx work --mine". The Inbox, its own page and the Changes page share an
"Assigned to" filter — Mine, All or one person, matched by email — that opens on
Mine when the current user has open work assigned there and on All otherwise. A
change matches when it or any of its open tasks is assigned to the person (change
rows carry `taskAssignees`, the open tasks' and subtasks' assignees), as
`ndx work --mine` selects a task by its own assignee. It hides rows only.

## Work › Tune: Agent settings and Outcomes by tier

Tune is the second mode of the Work page (`/tune`).

**Agent settings.** The settings that steer an agent run, editable in place:

- **Models.** The model per tier of the active vendor and what each tier is used for. Saved through `PUT /api/llm/config`, with the same keys as Settings › Robot Wrangler (the agent tier as `hench.models.<vendor>`). Vendor, failover and review stay in Robot Wrangler, which the section links to.
- **Rules.** Allowed commands and git subcommands, blocked paths, project skills, the test gate commands, review mode and the per-run and per-day spend caps. Saved through `PUT /api/hench/config` with the Workflow page's field editor; the section links to Workflow for every other work setting.
- **Agent prompt.** The project's prompt file, added to the system prompt of every hench run, its reviewer and the Sidecar (see the configuration guide).

A save here makes an open Settings page re-read, and a save in Settings makes the tile re-read, unless the other side holds unsaved edits.

**Outcomes by tier.** The gate pass rate per vendor and tier: the share of gated runs whose test gate passed.

- **Window.** The last 30 days. The tile states the start date.
- **Runs on this machine.** It reads hench run records from disk, across every worktree of this checkout still present. Records are machine-local, so runs made elsewhere, and runs in worktrees since removed, are not counted.
- **Keyed on vendor and tier.** Never on model name, since models are renamed and retired. A row's tooltip lists the resolved models for audit.
- **No gate result.** A run with no gate result stays out of the rate and is counted separately ("N runs without a gate result, not in the rate"). A row with no gated run shows `–`, not 0%.


## Sidecar on Plan and Tune

With `web.sidecar` on, Plan and Tune offer the Sidecar drawer as a second way to do what they already do. With it off, none of the entry points below render and every Plan and Tune element works as before.

**Entry points.**

| Where | Control | Opens |
|---|---|---|
| Plan's New change panel and the Add Items page, beside Preview | **Plan with Sidecar** | The Plan lens with the typed text, which goes as the session's first turn. Scoped to the area when the capture was. If the open session cannot take the turn, a new one starts or the drawer says why. |
| Area view | (attaches itself) | An `area` page item, with Explain by default. **Plan in this area** switches to the Plan lens aimed at that area. Closing the view or opening another area drops the Plan lens. |
| Inbox change | **Place with Sidecar** (replaces **Draft with the model**) | The Place lens on that change, with its placement card. |
| Specs to tighten | **Tighten with Sidecar** | The Describe lens on the change. |
| Open changes rows | **Describe in Sidecar** | The Describe lens on the change. |
| Tune, Runs tile | **Diagnose in Sidecar** on a task's newest failed run | The Diagnose run lens on that task. |

On Tune, the run classifier's verdict chip on a failed run shows whether or not the Sidecar is on. Spend carries the Sidecar's own bucket; the Sidecar's vendor, model, mode and caps are in Settings › Workflow.

**One placement surface.** One place decides a change's placement at a time. While the drawer holds that change's placement card, the placement panel shrinks to one line, "Placing with Sidecar · decide in the drawer", and the spec map follows the card's selected row, both ways. **Place by hand** reopens the panel with the card's selection. It also covers the card's withdrawal after 60 seconds.

**Active work.** A card that would write to an item an agent run is executing, or that a worktree has claimed for a run, says so ("Being worked by an active run in `<worktree>`"), and its parents count too. Approve then takes a second press, and the server checks again on approval: an item that became held while the card waited answers 409 until the approval acknowledges it. The session's brief opens with the items active work holds, so the Sidecar avoids proposing writes to them.

**Ghost items.** While a change-set card waits, its items show wherever a change appears: the PRD tree, Open changes rows, markers on the area map and the area view's spec map, and a "+N waiting on a card" note in the lifecycle strip. Real counts never include them.

**Without the Sidecar.** Everything above is hidden. Plan keeps Preview, Draft with the model and the placement panel; Specs to tighten still links to the filtered list; the Tune tiles keep working.

## Start Working

The Start Working / Start Task button (the Rex Dashboard's Up Next card, the
Hench Runs empty state, the Live idle card, each Workspaces card and the PRD
task panel) is a split button:

- **The button** starts the run in one click (`POST /api/hench/execute`). A
  task with saved run settings runs with them — the request carries no
  options, so the task's `run` block is what `ndx work` applies. For a task
  with none, the execute also carries `saveRun: {run, version}` — the project
  defaults the Prepare task modal would show, and the version the read
  reported — and the server saves that block on the task as its `run` block,
  so the settings the run used are visible and editable on the task
  afterwards. Unlike a Save, this block keeps fields equal to today's
  defaults: it records what the run used. Settings a task cannot hold
  (`bypassPermissions`, the launch-time options) stay with the project.
- **The ▾ arrow** opens the Prepare task modal, to change the settings for one
  run or save them on the task.

Where the button carries the run-mode picker (one task, a set number, until
done), the picker governs the click and its label says so ("Start working ·
until done"); it falls back to one task after each start.

**The save happens only when the run starts.** `POST /api/hench/execute`
checks `saveRun` with the same validator as `PUT /api/hench/prep/:taskId`
(a malformed or catalog-refused block is a 400 keyed `saveRun…`), runs every
execute gate — the slug-rule 412, blocked or non-actionable status, paused
executions (503), a run already executing or starting, a claim from another
worktree, an in-progress run still holding the task — and only then writes
the block, through the same save path and version check as the PUT, right
before it spawns `ndx work`. A start refused by those gates leaves the task's
`run` block and the working tree unchanged. One that passes them and then
fails to spawn (a 500) has the block taken off again, best effort: the clear is
versioned, so a block someone else saved meanwhile stays, and the task keeps the
modification stamp the save left. When the read already reports a refusal (a dirty
tree, the slug-rule 412) the click sends no `saveRun` at all, since a dirty
tree is refused only by the spawned run. When the read fails (a resolve error,
its timeout, the server's cap on reads in flight), the click still starts the
run as a plain execute: `ndx work` applies whatever the task carries, and only
the snapshot of the defaults is skipped.

Behind the hub's queue, the `saveRun` waits in the queue entry and is
replayed with the request, so it is saved when the queued run actually
starts; a run dropped at its turn saves nothing. `execute/check`, which the
hub asks before queuing, answers for a malformed `saveRun` and a version
conflict too.

If someone else saved settings on the task since the read, the start is
refused with 409 `conflict: true` and nothing runs; the button says so and
keeps the reason on screen, and a second click on the task, which now carries
settings, runs with them. Like any save, it writes the PRD, so the run commits
it first as a planning commit.

## Prepare task

The Prepare task modal shows every per-task `ndx work` option before a run
starts: hench's resolved value for each, the key that supplied it, the
refusals a run would hit, the equivalent terminal command and a brief preview.
Start Working's ▾ arrow opens it.

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
