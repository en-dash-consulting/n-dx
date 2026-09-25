# @n-dx/web

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.7.2
  - @n-dx/rex@0.7.2
  - @n-dx/sourcevision@0.7.2

## 0.7.1

### Patch Changes

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - The dashboard's Architecture, Problems and Suggestions views now unlock after a cascade analysis. They were gated on generative passes 2–4, which a cascade run never performs even though its single judged pass already produces all of those findings, so they stayed locked however often the project was re-scanned. `zones.json` now records `enrichmentMode`. For files written before that field existed, the dashboard falls back to the manifest's last run mode.

- [#393](https://github.com/en-dash-consulting/n-dx/pull/393) [`0415d3e`](https://github.com/en-dash-consulting/n-dx/commit/0415d3e2232787f9277de56c0e25e2c1b9959df6) Thanks [@endash-shal](https://github.com/endash-shal)! - A claim takeover in a linked worktree now reaches the Sessions tray when the run file is saved, not on the next poll.
  
  `GET /api/worktrees` now watches every non-served worktree's `.hench/runs/` itself — previously only the Runs view registered those watchers, so with the tray open and the Runs view never visited, a takeover waited up to 15s. A runs-directory change also drops the worktrees answer cache, so the tray's refetch is not served a pre-change answer. On the hench side, a takeover observed before the run loop attached its listener is now stamped on the run too.

- [#393](https://github.com/en-dash-consulting/n-dx/pull/393) [`0415d3e`](https://github.com/en-dash-consulting/n-dx/commit/0415d3e2232787f9277de56c0e25e2c1b9959df6) Thanks [@endash-shal](https://github.com/endash-shal)! - A run whose task another worktree takes over mid-run now says so in the dashboard's Sessions tray.
  
  Since claims began being renewed for the length of a run, a refused renewal meant the task quietly left the run's held set: the run carried on by design, and nothing anywhere recorded that the task was no longer its to finish. The renewal now emits the takeover, the run loop stamps it on the run record as an additive `claimLost` entry and saves immediately, and the Sessions tray renders "claim taken over by <worktree>" beside that run. Run records written without the field load unchanged.

- [#394](https://github.com/en-dash-consulting/n-dx/pull/394) [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard prices token usage per model and shows the split. Its aggregation now carries a `byModel` split (from hench turn records, the rex execution log, sourcevision, and the dashboard's own Ask ledger) and prices it through rex's `estimateCostFromTotals` — imported via the rex gateway, so there is one copy of the pricing arithmetic and both surfaces quote the same figure for the same runs. The Token Usage view gains a Cost by Model table (input/output/cache write/cache read/cost per model, with unknown ids labelled "priced as claude-sonnet-5" and an unattributed line for model-less tokens) and drops its hardcoded per-million rate labels. Also fixes `ndx usage`'s headline undercount: the package rollup now counts `smart_add_token_usage` events, which its own By-command breakdown (and the dashboard) already included.

- [#403](https://github.com/en-dash-consulting/n-dx/pull/403) [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add a dashboard glossary and render definition lines for terms an outside
  first-use review could not explain.
  
  An outside first-use review could not tell what "zone", "zone pin",
  "enrichment pass", "archetype", "guard rail", "epic / feature / task" or
  "worktree anchor" meant, because the dashboard showed those terms with no
  explanation.
  
  - `packages/web/src/viewer/components/glossary-terms.ts` is the single source
    of truth: one plain-language sentence per term. `GlossaryLine` (a new
    viewer component) renders it where each term first appears.
  - Wired at: Files (`archetype`, the Archetype column), Zones (`zone`, under
    the page's stat line), the zone detail slideout (`zone pin`, only when the
    zone has a pinned file, so the definition sits beside the "pinned" badge
    it explains), enrichment-gated views (`enrichment pass`, under the
    "Requires enrichment pass N" gate), the PRD tree (`epic / feature / task`,
    under the Tasks header), Workspaces (`worktree anchor`, under the page
    subtitle), and hench Config's Guard Rails category (`guard rail`).
  - The Files table reads the archetype definition to screen readers once, as
    the table's description (`aria-describedby`); the copy shown in the column
    header is marked decorative, so it is not repeated for every cell.
  - "weight" is not in the glossary: the dashboard never shows the word (the
    Zones view shows call counts), and CONTEXT.md's "weighted avg cohesion"
    means weighted by file count, a different thing.
  - Tests: every glossary term is wired to a view, and render tests check the
    conditional placements (guard rail, zone pin) and the Files table's
    accessibility markup.
  
  No route, view id, config key, or `--format=json` output changed, and no
  gateway export was added. The web boundary check's two-consumer rule for
  `src/shared/` now counts a zone only when it imports that module's own
  symbols; before, any import of the shared barrel counted for every module,
  so the rule could not fail.

- [#391](https://github.com/en-dash-consulting/n-dx/pull/391) [`bb4f829`](https://github.com/en-dash-consulting/n-dx/commit/bb4f829b0d676024fce715ee5da4db0ed2a429b5) Thanks [@endash-shal](https://github.com/endash-shal)! - An invalid `.hench/config.json` no longer bricks `ndx work`, and the dashboard can no longer write one.
  
  - hench's schema now fills a partial `retry` group with per-field defaults (sourced from `DEFAULT_RETRY_CONFIG`), so a config carrying only `retry.maxRetries` loads instead of failing with `NDX_CLI_INVALID_CONFIGURATION`.
  - `hench run` loads config leniently: an invalid top-level setting is replaced with its default and reported as a warning naming it, instead of refusing the whole run. Salvage works per top-level key, so one bad field inside a group (say `retry.maxDelayMs`) resets that whole group (`retry`). A file that is not valid JSON still fails as before; a document that fails validation and cannot be salvaged (a non-object document, for example) now names the offending fields instead of a generic "corrupted" message.
  - Every dashboard write path (`PUT /api/hench/config`, adaptive apply/override, workflow suggestion apply, template apply) completes a partially-written nested group from `CONFIG_GROUP_DEFAULTS` before serializing, so a single `retry.*` edit can never leave a one-member group on disk. The mirror between web's group defaults and hench's config defaults is pinned by `tests/e2e/hench-config-gate-contract.test.js`.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard tells a held claim from a live run
  
  A claim kept by a finished run (uncommitted work left in its worktree) looked
  identical to a run in progress: `GET /api/rex/claims` omitted the hold
  reason, the PRD tree chip said `claimed · <worktree>`, and Execute's 409 said
  the task "is being worked on" — sending the operator to look for a process
  that ended hours ago. Claims entries now carry `reason` when (and only when)
  a claim is held; the chip reads `held · <worktree>` with a tooltip naming the
  uncommitted work and `ndx claim release <id>`; and the Execute 409 for a held
  task explains the hold and how to free it. A live claim keeps today's wording
  everywhere.

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - Product logos, the per-view favicon and the notification icon load again when the dashboard is served through the hub at `/p/<id>/`. The dashboard's Isometric Map now behaves like the `sv iso` output: "Open on its own" and the breadcrumb switch scenes in place (they were dead inside the dashboard's sandboxed frame), and the map regenerates when a new analysis or background narration lands.

- [#378](https://github.com/en-dash-consulting/n-dx/pull/378) [`daef846`](https://github.com/en-dash-consulting/n-dx/commit/daef846d95ffbbd0ca3517e88139d1493dccf4f0) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix project-settings validation of `sourcevision.zones.mergeThreshold`: the dashboard capped it to 0–1 as if it were a Louvain modularity ratio, but it is the small-zone merge threshold — a minimum zone size in files, default 3. The server route and settings view now accept any non-negative integer, and the field's description, placeholder, and default hint describe the real semantics.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard's next-task suggestion skips tasks other worktrees hold
  
  `GET /api/rex/next` and the dashboard's Up Next card (`GET /api/rex/dashboard`) suggested the
  highest-priority task without consulting the cross-worktree claims store,
  while the Execute button refuses a claimed task with 409 — so the dashboard
  could recommend exactly the task it would then refuse to start. Both reads
  now exclude foreign live claims for the request's workspace — the same set
  Execute's check consults — so the suggestion is always a task Execute will
  accept. When a higher-priority task was passed over because another worktree
  holds it, the response says which task and which worktree
  (`skipped`/`nextTaskSkipped`), and the Up Next card shows it: `"<task>" is
  claimed by <worktree> — showing the next unclaimed task`.

- [#416](https://github.com/en-dash-consulting/n-dx/pull/416) [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Offer to migrate a non-conformant PRD tree at the gate, and stop rather than continue
  
  A tree whose slug-rule marker names another rule, or whose paths do not match the
  running rule, used to dead-end a run with a refusal and an instruction to go and
  run `rex migrate-slugs` by hand. `ndx work` and the dashboard's Execute now close
  that loop — and stop there.
  
  Stopping is the point. On a non-conformant tree `migrate-slugs` is not a no-op: it
  rewrites every path that does not match the running rule, which can be the whole
  tree. The command exists to perform that rename deliberately, in one reviewable
  commit, instead of letting the next ordinary save produce a surprise mass diff.
  Running it inside a task run and carrying on would turn it straight back into that
  surprise diff, with the rename landing in whatever commit the task makes next under
  a message about something else — the 2026-09-17 incident (a pull request merging
  1,570 re-slugged files through green CI) with the human step deleted rather than
  automated. So the migration gets its own commit, and the operator reviews it and
  starts the run again.
  
  - **CLI.** An interactive `ndx work` prints the paths the migration would rename
    and asks. Accepting spawns `rex migrate-slugs`, reports what changed, and exits
    without executing the task. Declining rethrows the refusal unchanged.
  - **Autonomous runs are never offered it.** `--auto`, `--loop`, `--epic-by-epic`,
    `--yes`, a non-terminal stdin and CI all refuse exactly as before, and the
    message now names which of those withheld the offer instead of the run silently
    behaving differently from an interactive one. `--dry-run` is never offered it
    either, even on a terminal: a dry run promises not to touch the working tree.
  - **Dashboard.** The 412 from Execute now carries `migratable`, and Start Task
    offers a "Migrate the PRD tree" button under a refusal a migration would fix.
    Accepting sends a second explicit `{ migrateSlugs: true }` request — consent is
    carried by the request rather than inferred, since the server has no session —
    which migrates and returns without starting the task.
  - **A tree on a newer rule gets no offer at all**, in either surface.
    `TreeConformanceRefusal` gained a `migratable` flag computed from the same
    direction rule `assertSlugRuleAdoptable` enforces, so a gate cannot offer a
    migration the command would refuse.
  
  The store-level write guard is unchanged and still refuses from inside the PRD
  lock, which is where it has to stay: `migrate-slugs` needs that same lock, so
  recovering there would deadlock.

- [#410](https://github.com/en-dash-consulting/n-dx/pull/410) [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4) Thanks [@dnaniel](https://github.com/dnaniel)! - A fragmented zone partition is no longer frozen. Before a previous partition is reused or used as the Louvain seed, sourcevision checks its health: one where at least 40% of zones hold two files or fewer is rebuilt from scratch, and in the borderline band Jev decides. The rebuild happens once per input fingerprint and needs no `sv reset`. Background narration no longer loses work: a new `analyze` stops a still-running narrator and queues what it had not finished. `ndx status` and the dashboard overview report pending or failed narration, and `ndx plan` waits for narration before `rex analyze`.

- [#390](https://github.com/en-dash-consulting/n-dx/pull/390) [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396) Thanks [@endash-shal](https://github.com/endash-shal)! - Price token usage at each model's own rates instead of Claude Sonnet's.
  
  **Reported costs rise on upgrade — typically by about half, and Opus-heavy
  projects by up to about two-thirds.** Dashboard and CLI cost figures go up
  because runs are now priced at each model's own rates instead of a flat
  Sonnet rate; no tokens were added and nothing runs more expensively. On this
  repo's baseline batch the same runs moved from $161.08 (flat Sonnet) to
  $247.53 (per model), a 54% rise — the old figure under-reported by about 35%.
  Budget alerts or dashboards keyed to the old under-reported figures will see
  a one-time jump.
  
  `estimateCost` took a `ModelPricing` parameter that every caller left at a
  single hardcoded Sonnet default (3/15 per MTok, cache write 3.75, cache read
  0.30). Opus (5/25) usage was therefore quoted at three-fifths of its real cost —
  on this repo's own run history, which is not all Opus, $124 quoted against a
  real $186. The `(based on Sonnet pricing)`
  label made that honest rather than silently wrong, but it left the figures
  unusable for the before/after comparisons the cost work depends on.
  
  - `@n-dx/llm-client` — `MODEL_COSTS` gains cache-write and cache-read rates,
    so the existing catalog now covers all four billed token kinds for every
    model in `TIER_MODELS` across claude, codex and google. New `model-pricing`
    module exports `resolveModelPricing` (exact id → Claude alias → Codex legacy
    remap → lower-case retry → labelled fallback) and `priceTokens`. Two known under-reporting
    caveats are documented on the table: a 1-hour cache write bills at 2x input
    rather than 1.25x, and long-context surcharges apply above 200K input on
    some models. Neither is recoverable from aggregate token counts.
  - `@n-dx/rex` — token aggregation carries a per-model split (`byModel`) drawn
    from hench per-turn records, which already recorded vendor and model, so a
    run that switched models mid-flight is priced per segment rather than at its
    run-level model. `estimateCost` prices each bucket at its own rates and
    reports a per-model breakdown; tokens with no recorded model, and any
    remainder between the buckets and the totals, form a separate `unattributed`
    line at the fallback rate. An unrecognised model id degrades to that same
    labelled fallback rather than throwing or pricing at zero. `ndx usage` now
    prints the per-model split in place of the blanket Sonnet caveat, and emits
    it in `--format=json`.
  - `@n-dx/web` — the dashboard's duplicate pricing literal is gone; it resolves
    the same fallback rates from the shared table. Its aggregation now carries
    its own per-model split and prices it through rex's arithmetic, so dashboard
    and CLI figures agree for the same runs (see the dashboard-per-model-pricing
    changeset in this release).

- [#395](https://github.com/en-dash-consulting/n-dx/pull/395) [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Preserve unknown `tree-meta.json` keys, and check a PRD tree that carries no slug-rule marker before writing it.
  
  Two changes to the same fault. A rex MCP server running a build older than the
  `slugRule` field saved the PRD and rewrote `.rex/tree-meta.json` from a type
  that had no such field, erasing the marker. No path moved and no item changed —
  the two builds shared a slug rule — but the write guard was silently disarmed
  for whoever wrote next.
  
  - **Every `tree-meta.json` write now reads the file first and carries forward
    keys it does not recognise.** This cannot repair a sidecar an older build has
    already stripped; it stops the next such loss, between this version and the
    ones after it.
  - **A tree with no marker is no longer adopted *silently*.** It is still
    adopted when every path already matches the running slug rule — the save
    records the marker and prints a one-line notice naming `rex migrate-slugs` as
    the way to verify, and `rex validate` reports the same thing as a warning
    rather than an error. What changed is that adoption is now visible, and that
    it is conditional: an unmarked tree with a path this build did not write is
    refused outright, by the store guard, `rex validate`, the `ndx work` pre-run
    gate and the dashboard's Execute gate, all saying `slug rule marker missing;
    run rex migrate-slugs`.
  
  Absence covers two states — a tree older than the guard, and one whose sidecar
  a build older than the field rewrote without the marker — and nothing on disk
  separates them. The path scan is not a perfect tiebreak either: it can only
  recognise a rule this build can reproduce, so a tree re-slugged by a *future*
  build would scan clean. That hazard is not yet reachable, because there is no
  such rule to have written one; whoever adds one moves the guard back to a
  refusal in the same commit.
  
  `rex migrate-slugs` remains the way to re-derive every path rather than trust
  the scan, and it now reports `slugRuleRecorded` in its JSON output — on an
  already-conformant tree it renames nothing, so the counts alone read as
  "nothing happened" when it was the run that recorded the marker.
  
  **Upgrading costs nothing on a conformant repository.** The marker is new in
  this release, so every existing tree arrives without one; those written by 0.5.2
  and later already follow the current rule and are adopted on their next save. A
  tree predating that carries paths from a superseded rule (0.5.1 suffixed every
  slug with `-{id6}`; the current rule first shipped in 0.5.2), and its writes are
  refused until `rex migrate-slugs` is run — `rex validate` already reported those
  paths before this release, but nothing stopped a write from re-slugging them. A new project
  is unaffected: an empty tree has nothing a marker could be wrong about, so a
  first save proceeds and records one.

- [#405](https://github.com/en-dash-consulting/n-dx/pull/405) [`9369d40`](https://github.com/en-dash-consulting/n-dx/commit/9369d409ceec8e9fe3834adb5614a086cb2e6c23) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard closes a removed worktree's run watcher
  
  The Sessions tray watches every other worktree's `.hench/runs/` so a claim
  takeover or a finishing run reaches it as a push. Nothing closed those
  watchers when a worktree was removed, so a long-running dashboard accumulated
  handles on directories that no longer existed (the OS error event covers some
  platforms, not all). The `/api/worktrees` refresh now prunes watchers whose
  worktree left `git worktree list`; a worktree that comes back re-registers
  lazily as before, and server shutdown still closes everything.

- [#384](https://github.com/en-dash-consulting/n-dx/pull/384) [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx work` and the dashboard's Execute now refuse to start against a PRD tree written under a different slug rule, instead of discovering it at the completion write.
  
  An autonomous run writes the PRD when it finishes its task, so a run started with a mismatched build does not fail — it succeeds, and carries a whole-tree re-slug into whatever branch is open under a "task completed" commit. The store's write guard refuses that write, but only after the run has claimed the task, spent its tokens and edited the code.
  
  Both surfaces now ask the question first, through rex's new `checkTreeConformance`: the CLI refuses before taking a claim or writing anything (including on `--dry-run`, so a preview cannot report that the real run would have been fine), and `POST /api/hench/execute` answers 412 with the same message, which the viewer already surfaces on the run card. Unlike the write-time guard, a tree whose marker agrees is still path-scanned, so one whose paths were disturbed is refused too. There is no override flag: the fix is `rex migrate-slugs`, or upgrading rex when the tree was written by a newer rule. An interactive `ndx work` or the dashboard can offer to run the migration for you and then stop without executing the task.

- [#403](https://github.com/en-dash-consulting/n-dx/pull/403) [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Show analysed, inventoried-only, and skipped languages with counts on the Files page.
  
  The Files table only ever showed `byLanguage`, so a project with a language sourcevision doesn't recognize (e.g. Zig) had its files silently dropped from the inventory during the code-only walk — nothing on the page said so. `analyzeInventory`'s summary now additionally records `skippedExtensions` (extension -> file count, for files the walker saw but excluded) and `analysedLanguages` (the subset of `byLanguage` whose files take part in import-graph and zone analysis). Both fields are optional and additive, so inventories written before this change still load.
  
  The Files page now renders a strip above the table stating which languages were analysed, which were inventoried only, and which extensions were skipped, each with counts — reading the new fields when present and degrading to a single neutral "Inventoried" group when they're absent.

- [#417](https://github.com/en-dash-consulting/n-dx/pull/417) [`737b396`](https://github.com/en-dash-consulting/n-dx/commit/737b39611b68c04dbfdebfb94933102483ee9417) Thanks [@ryrykeith](https://github.com/ryrykeith)! - test: make test results independent of machine load
  
  Tests and test configuration only. No production code changes, so published output is unaffected; these packages ship `dist` only.
  
  - **web:** viewer tests now commit every preact render, update and unmount inside `act()`. Previously, a render outside `act()` left preact's after-paint fallback timer pending, and if it fired after jsdom teardown it threw `ReferenceError: cancelAnimationFrame is not defined`, failing a suite whose summary said every test passed. A new setup file, `tests/setup/preact-frame-leak-guard.ts`, fails any test file that still leaves that timer pending, and names the file.
  - **web:** the watcher-based waits in the worktree integration tests now scale with `NDX_TEST_TIME_MULTIPLIER`, and their git fixtures are removed with retries.
  - **sourcevision:** every spawn in `cli-hints.test.ts` gets a load-scaled kill budget instead of a fixed 10 seconds.

- [#406](https://github.com/en-dash-consulting/n-dx/pull/406) [`8040ca0`](https://github.com/en-dash-consulting/n-dx/commit/8040ca0b8d04c21e4c8857fc95ccd5f54c327fd7) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `hench.tokenBudget` counts cache writes and excludes cache reads
  
  `checkTokenBudget` summed `input + output`. With prompt caching, `input` holds
  only the uncached slice — an 83-turn API-loop run recorded 534 uncached input
  tokens against 876K cache writes and 34.1M cache reads — so a configured budget
  bounded output plus a rounding error, and the run continued to `maxTurns`
  instead of stopping.
  
  The budget now counts **uncached input + cache writes + output**, on the API
  loops and the Claude and Codex CLI paths alike, and excludes cache reads. A
  cache read is by construction a re-read of tokens already counted when they
  were written, so counting reads would charge the same tokens once per turn:
  across the 27 recorded runs in this repository, face value ran a median of
  **70x** the counted total. On the Claude CLI path, where the check runs after
  the session has finished, that would have marked every non-trivial run
  `budget_exceeded` and reset its task before the review and commit steps. The
  rule needs no price table and stays vendor-neutral, and runaway loops remain
  bounded because cache writes and output both grow with turn count.
  
  A run that writes no cache counts exactly what it did before. A Claude Code
  session always writes one, so on the CLI path every run now also counts its
  cache writes, and a budget tuned to the old accounting may need raising on
  either path.
  
  Also:
  
  - Built-in template budgets re-derived from measured runs. Counted cost is
    affine in turn count — roughly `190,000 + 5,400 x turns`, where the constant
    is the initial context write — so each budget is that fit at the template's
    `maxTurns`, doubled for headroom: quick-iteration 50K -> 600K,
    thorough-execution 200K -> 1.5M, budget-conscious 30K -> 600K,
    api-direct 150K -> 850K. The old values predated prompt caching and sat
    below a single median run. `budget-conscious` is not tightened below
    `quick-iteration` despite its name: measured runs in its turn class
    *completed* at 484K and 489K, so a lower budget would fail finished work —
    it economises through `maxTurns` and its 4096 `maxTokens` cap instead. The
    dashboard's template list carries the same values.
  - The budget-exceeded message now names the token classes that counted and how
    many cache-read tokens were excluded, so a genuine overrun can be told apart
    from cache-read inflation.

- [#390](https://github.com/en-dash-consulting/n-dx/pull/390) [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396) Thanks [@endash-shal](https://github.com/endash-shal)! - test(web): count render and traversal work in the viewer tree performance suites instead of timing it
  
  `large-tree-performance.test.ts` and `prd-tree-live-tick-perf.test.ts` held 25 of
  the repo's elapsed-time assertions, all comparing `performance.now()` against an
  absolute budget scaled by a `BUDGET_MULTIPLIER` hardcoded to `10` rather than read
  from `NDX_TEST_TIME_MULTIPLIER`. Under full-suite load, the live-tick budget of
  160ms measured 420.10ms while the same file completed in 108ms run alone. Raising
  the budgets is not available — TESTING.md forbids padding one to green a suite,
  and the next busier machine just fails at the new number.
  
  Growth-ratio timing was tried first and rejected on measurement: `diffItems` timed
  across an 8x size step read 7.7x idle and 46.5x loaded, because min-of-N filters
  a ~4ms block and a ~30ms block differently. A ratio only cancels load when both
  readings face the same preemption risk, which sub-millisecond work cannot give.
  
  Both files now count work (TESTING.md Family 2, technique 1) via a new
  `tests/helpers/tree-work-count.ts`:
  
  - `countTreeReads` instruments the fixture's `children` arrays, so a traversal's
    step count is exact. Reads per node hold to three significant figures across a
    7.97x size range and are unchanged with every core saturated; an injected O(n²)
    reads 197.8 per node against a clean 1.18, and grows 62.91x against a 15.94x
    bound.
  - `countRenderWork` counts vnodes diffed via Preact's `options.diffed` hook and
    DOM records via a `MutationObserver`. Both counters are needed: a broken
    `shouldComponentUpdate` gives 7 805 diffs / 442 mutations against a clean
    1 033 / 1, while churning row keys gives 263 / 512 — each regression is
    invisible to the other counter. Both were injected and confirmed failing.
  
  Two non-timing assertions in the same file were also failing under load. Every
  render is now unmounted: `useLiveTick` starts a real 1s `setInterval` while an
  in-progress row is visible, so each render previously left a live interval
  re-rendering a 500–2000 row tree for the rest of the file, free to interrupt a
  later test mid-measurement.
  
  The DOM-per-item assertion also stops guessing. It subtracted a hardcoded
  `overheadEstimate = 200` for the tree's chrome; the real figure, measured by
  rendering an empty document in the same process, is 9. It had been reporting 18.6
  DOM nodes per row where the true value is 21.7 — passing, but not for the reason
  it stated.
  
  Full suite verified green with a concurrent `pnpm build` and every core saturated
  (15-minute load average 24.6). No production behaviour changes.
- Updated dependencies [[`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`ee16578`](https://github.com/en-dash-consulting/n-dx/commit/ee165780ecdc34ad0349ab7028875f04bff769e0), [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1), [`7b5d253`](https://github.com/en-dash-consulting/n-dx/commit/7b5d253faec104a417505d4baa4aa3a7ec0348f1), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`fdb8376`](https://github.com/en-dash-consulting/n-dx/commit/fdb8376fa554f7ef92c65e3819def5dbbf74e933), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`fdd864c`](https://github.com/en-dash-consulting/n-dx/commit/fdd864c4db245e5d69a0ae78534f07c0cc752c0e), [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f), [`e70e787`](https://github.com/en-dash-consulting/n-dx/commit/e70e787b40ada9ecaf17069b7e4f11246ebb235f), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`11634bb`](https://github.com/en-dash-consulting/n-dx/commit/11634bb4c60b66ecf9afda843ac4f03ea9b6a396), [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`87c0af9`](https://github.com/en-dash-consulting/n-dx/commit/87c0af99fd7f9bdc4f563d74f323166307bb3e26), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`bb4f829`](https://github.com/en-dash-consulting/n-dx/commit/bb4f829b0d676024fce715ee5da4db0ed2a429b5), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7), [`6bee073`](https://github.com/en-dash-consulting/n-dx/commit/6bee073fd946866760cced673afd9ac4fcaa0675), [`a136bbc`](https://github.com/en-dash-consulting/n-dx/commit/a136bbc4f21719624f96d98bb82420c8fce9b649), [`95fe231`](https://github.com/en-dash-consulting/n-dx/commit/95fe2311fafc93a7f6aaa76bcdf44b99ff9f03cb), [`5866f4e`](https://github.com/en-dash-consulting/n-dx/commit/5866f4eddf660fb4d254dd9a6e66e1fbc4aae7d7), [`737b396`](https://github.com/en-dash-consulting/n-dx/commit/737b39611b68c04dbfdebfb94933102483ee9417), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4), [`89990ff`](https://github.com/en-dash-consulting/n-dx/commit/89990ffa0c86f7ca9bc41d10eeb3b295973b6ac4)]:
  - @n-dx/sourcevision@0.7.1
  - @n-dx/rex@0.7.1
  - @n-dx/llm-client@0.7.1

## 0.7.0

### Minor Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the hub daemon skeleton (`web hub`, default port 3117): a per-user registry at `~/.n-dx/hub.json` with atomic writes, a `~/.n-dx/hub.pid` file, and `/api/hub/*` routes (`GET /health`, `GET|POST /projects`, `GET|DELETE /projects/:id`). Registering a project spawns `<ndxBin> serve --port=0 <repoRoot>`, reads the bound port from `<repoRoot>/.n-dx-web.port`, and records pid and port. Children are health-checked every 15 s via `GET /api/status`, marked unreachable when they stop answering, and respawned once. On restart the hub re-attaches to children whose recorded pid is alive and answering, and respawns the rest. `$N_DX_HOME` overrides the registry directory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start` now registers the repository with the per-user hub by default and serves it at `http://localhost:3117/p/<id>/`; `--here` (or `web.mode: "here"`) gets the single-project server that owns the port. `ndx start stop` unregisters the worktree it runs in through the new `DELETE /api/hub/projects/:id/worktrees/:path` — the project keeps being served while another worktree is registered, and the last one unregisters the project and stops its server. A hub left with no projects exits, unless `hub.keepAlive` is set in `~/.n-dx/config.json`. `ndx start status` reports the hub (pid, port, uptime), the project (id, state, server pid and port, repository, registered worktrees) and the URL. New `ndx hub status` and `ndx hub stop` address the hub itself from any directory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Per-project MCP endpoints through the hub: `/p/<id>/mcp/rex` and `/p/<id>/mcp/sourcevision` are proxied to that project's server with `Mcp-Session-Id`, SSE responses, the GET event stream and `DELETE` session close carried through; the root `/mcp/*` aliases the sole registered project and answers 409 with the ids when several are registered. Two registered projects have independent sessions and write to their own trees. README's HTTP registration section now uses the per-project URL and keeps the tracked `.mcp.json` as the recommended path.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Hub reverse proxy and viewer base-path support. Requests under `/p/<id>/…` are proxied to that project's server with the prefix stripped — HTTP streamed both ways, WebSocket upgrades piped through — and root-relative redirects are re-prefixed. With exactly one project registered the root (`/`, `/api/*`, `/data/*`, `/mcp/*`, the socket) aliases to it unchanged; with several, `/` lists the projects and other root requests answer 409 with their ids. The viewer derives its base path from `location.pathname` at boot, prefixes every root-relative `fetch` through one adapter, connects its sockets through one URL helper, and writes prefixed history entries, so every view and deep link works at `/p/<id>/<view>` while `web serve` at `/` is unchanged.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Per-workspace job state. The trackers that were process-wide singletons are now keyed by the workspace a request addresses (`src/server/workspace-scoped.ts`): the sv-analyze, refresh, self-heal, init, ci and reshape statuses and the `.sourcevision` writer lock in routes-commands; the epic-by-epic execution state and its hench process in routes-rex/execution; the active executions, execution metrics and process-memory tracker in routes-hench; and the status, project-metadata and config caches. Starting an analysis in worktree A no longer blocks or reports in worktree B; shutdown, emergency stop without a context, and the memory monitor sweep every workspace. A single-workspace server behaves exactly as before.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub now admits dashboard-started agent runs against machine-wide limits instead of letting every project start its own. A run is forwarded when fewer than `hub.maxSessions` are in flight across all registered projects and free memory is above `hub.memoryFloorBytes`; otherwise it is queued FIFO and answered `202 { queued: true, position }` rather than refused, and released when capacity frees. `~/.n-dx/config.json` gains `hub.maxSessions` (default 4) and `hub.memoryFloorBytes` (default 2 GiB), with every unusable key named once at hub start and falling back to its default rather than stopping the hub. `GET /api/hub/queue` reports the limits, what is running, what is waiting, and whether admission is paused for low memory.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The hub root now serves a home page with one card per registered project instead of a bare list. Each card joins the registry onto that project's own server — branch, uncommitted files, agents running, PRD progress and the next task — through the new `GET /api/hub/overview`, which the page also re-reads every few seconds so a card that changes while you are looking at it updates without a reload. A project whose server is not answering still gets a card saying so. Cards carry a "Start working" link into that project's Runs view rather than a second execute route, follow the dashboard's own theme (same storage key, so the choice carries between them), and are reachable from the keyboard.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Workspace registry: the server is anchored at the directory it was started in and holds one `ServerContext`, watcher set and PRD cache per worktree of the repository (`src/server/workspaces.ts`). The anchor is set up eagerly exactly as before; any other worktree is created lazily the first time a request addresses it — via the `X-Ndx-Workspace` header or the `/w/<key>/` slot — and falls back to the anchor otherwise, so nothing observable changes for a single-worktree server. Keys are worktree basenames (`main` aliases the anchor); the list refreshes from `git worktree list` every 30 s and on `POST /api/workspaces/refresh`, releasing the resources of a worktree that disappeared (never the anchor). `GET /api/workspaces` lists them.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Workspace-tagged WebSocket frames and the breadcrumb workspace switcher. Every broadcast now carries `{ workspace: <key> }` — watchers and routes stamp the workspace they act on, process-wide monitors stamp `"*"` — and the viewer drops frames for another workspace (untagged frames read as the anchor's), so a change in one worktree no longer makes a tab on another refetch. The breadcrumb's branch chip is now a keyboard-accessible listbox of every worktree with the anchor starred, a pulse for running work, elapsed time since the last run and the dirty-file count; choosing one opens the same view under `/w/<key>/`, and a footer links to the Workspaces overview.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `/w/<key>/` URL slot for worktrees. The viewer's base path now carries the workspace slot alongside the hub's `/p/<id>` prefix, so `/w/feature/prd` (or `/p/app/w/feature/prd`) deep-links to that worktree's tree and every fetch, socket and history entry the viewer builds keeps the slot. The project server strips the slot before dispatch and resolves the workspace in the registry, accepts `X-Ndx-Workspace` for non-browser clients, answers an unknown key with a 404 page linking to the anchor, and serves slot-less paths from the anchor exactly as before.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the Workspaces Overview view: a new WORKSPACES sidebar section (above SOURCEVISION, one item "Overview") opening a board of one card per git worktree of the served repository, under a machine strip of four stat tiles — agents running, memory in use, uncommitted trees, and PRD items that exist only on branches.
  
  Each card carries the worktree's branch, its live hench run (task title linking into *that* worktree's PRD, elapsed time, tok/s and last output line) or when it last ran, an uncommitted-files or clean chip, a PRD-delta chip versus the anchor, and the actions Open workspace, Start working and Stop. The board addresses each worktree with the `X-Ndx-Workspace` header, and — uniquely among socket consumers — keeps frames about other workspaces rather than filtering them out, so a run progressing in one worktree moves its card while you are looking at another.
  
  `StartTaskButton` gains optional `workspace` and `ariaLabel` props; with `workspace` set the run starts in that worktree (cwd = worktree). Sidebar sections that end up with no visible items are no longer rendered as an empty header.

### Patch Changes

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Allowlist the config keys the adaptive routes may write.
  
  `POST /api/hench/adaptive/override` and `/api/hench/adaptive/apply` read a
  caller-supplied `key`/`configKey` and wrote it straight into `.hench/config.json`
  via an unguarded `setNestedValue` — no allowlist, no value check, no protection
  against a `__proto__` segment. A same-origin caller could set an invented key or
  mistype a real one, and the next autonomous hench run would inherit it. This is
  the sibling of the workflow-apply hole closed earlier.
  
  The config-field allowlist (`CONFIG_FIELD_META`), its value validation, and the
  nested get/set helpers now live in one shared module,
  `hench-config-fields.ts`, imported by both `routes-hench.ts` (the config editor,
  already allowlisted — the reference pattern) and `routes-adaptive.ts`, so the
  three config-write paths cannot drift. Both adaptive routes now reject (400)
  before writing when the key is not an allowlisted field, contains a
  prototype-poisoning segment, or carries a wrong-typed value; `setConfigValue`
  drops forbidden segments as defense in depth.
  
  Found by the 2026-09-11 adversarial security review follow-up (task 0a778581).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Write API keys to `.n-dx.local.json`, never to the shared `.n-dx.json`.
  
  `ndx config claude.api_key` (and `llm.claude/codex/google.api_key`) wrote the
  key into `.n-dx.json` — the file that carries zone pins, the vendor and the
  dashboard port, that the gitignore template calls safe to commit, and that
  `ndx init` never gitignores. Only `*.cli_path` was routed to the gitignored
  `.n-dx.local.json`; the help text itself said "stored in .n-dx.json — add to
  .gitignore". One `git add -A` put the key on the remote. The 0600 chmod on the
  file defends against other local users, not against git.
  
  `*.api_key` now joins `*.cli_path` in the local-only set. Every reader already
  merged the local layer over the shared one (core `config.js`, `@n-dx/llm-client`
  `loadClaudeConfig`/`loadLLMConfig`), so resolution is unchanged; the dashboard's
  `/api/ndx-config` auth-method detection was the one reader that looked at
  `.n-dx.json` alone and now merges too, so the footer keeps its ✓.
  
  For projects configured before this: every `ndx config` run warns on stderr
  when `.n-dx.json` holds an `api_key`, naming the key and the fix. Re-setting the
  key is the migration — it lands in the local file and the shared copy (and the
  legacy `claude.*` mirror of an `llm.claude.*` key) is removed. `ndx ci` gains a
  `config-secrets` step that fails when a git-tracked `.n-dx.json` contains an
  `api_key` and warns when an untracked one does.
  
  Found by the 2026-09-11 adversarial security review (finding A).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `GET /api/worktrees`: every git worktree of the served repository with branch, HEAD, anchor/served flags, dirty state, a summary of the hench runs recorded under it, and whether an `ndx start` server is present (pid/port marker files). Best-effort per worktree, cached for 5 s, `[]` outside a repository.
  
  Retire the half-built sibling-directory project scan (`GET /api/projects`, `detectProjects`): nothing in the viewer consumed it, and cross-project switching is the 0.7.0 hub registry's job.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix eight defects found reviewing this branch: the hub's API now checks the
  browser origin before registering a project (registration spawns a process);
  the hub restates the forwarded `Origin` so dashboard mutations and WebSocket
  upgrades work through the proxy in hub mode; the anchor's frames go out
  untagged so the single-worktree dashboard updates live again;
  `X-Ndx-Workspace` outranks the `/w/<key>/` slot, so the Workspaces board acts
  on the worktree it names; `ndx start --here` relocates rather than SIGKILLing
  the hub; the rex MCP path writes task claims (`claim_task`, `release_task`, and
  on `in_progress`) instead of only reading them; workflow-template config
  overlays go through the same allowlist as every other config writer; and a
  malformed percent-escape in a URL no longer ends either server.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix cross-worktree task claims under the dashboard and hub MCP endpoints. A
  claim's owner is now its worktree alone; the pid is only a liveness check.
  `ndx start` runs one rex MCP server per workspace inside a single process, so
  every worktree's claim carried that one pid — and an ownership test that
  accepted a matching pid let two worktrees hold the same task, let either
  release the other's claim, and silenced the dashboard's own "another worktree
  is working on this" refusal. `ClaimsStore.release` and `isClaimedByOther` now
  take the asking worktree rather than a pid.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Task selection is claim-aware across worktrees. `hench run` (what `ndx work` spawns) claims the task it selects — before the brief and any LLM turn — and releases it when the run ends (completed, failed, cancelled by Ctrl-C, or thrown); an explicit `--task` another worktree holds is refused with the holder's worktree, and a retry in the worktree that already holds a task takes the claim over. `rex next`, the `get_next_task` MCP tool and hench's autoselection pass over tasks other worktrees hold (`skippedClaimed` in JSON output, one line per task under `--verbose`), and `findNextTask` / `findActionableTasks` accept `excludeIds`. The dashboard's execute route answers 409 with `claimedBy` when another worktree holds the task. Outside a git repository nothing changes.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The static run detail now says why a failed run has no error text.
  
  `ndx export` strips `error` from both the per-run file and the `runs.json`
  index unless `--include-transcripts` is passed — an error body can echo
  whatever the agent read. The run detail rendered the Error section only when
  `run.error` was present, so an exported failed run showed a "Failed" badge and
  nothing else, indistinguishable from a run that failed for no recorded reason.
  
  `runErrorDisplay` now decides that section's contents: the failure body when the
  record carries one, otherwise a neutral notice for a failed run stamped
  `transcriptOmitted`, naming the flag that would have published the text. The
  Task Audit log viewer already did this for tool calls; the runs view now
  matches.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx export` no longer publishes agent transcripts by default, and `--deploy=github` confirms before pushing.
  
  Every `.hench/runs/*.json` was copied verbatim into the static site —
  `toolCalls[].input/output`, `events`, `error` bodies — and `--deploy=github`
  force-pushed the result to `origin/n-dx-dashboard` with no prompt. A run that
  had `cat`'d a `.env` or printed `process.env` put that on the remote; the
  project's own discovery notes had already called this a blocker. The default
  out-dir `./ndx-export` sat inside the repo and was not gitignored either.
  
  - Exported run records are passed through `sanitizeRunForExport`, which drops
    `toolCalls`, `events`, `error`, `diagnostics.promptSections` and
    `testGate.error`, keeps summaries and token usage, and stamps
    `transcriptOmitted: true` so the static Task Audit view can say why the
    transcript is absent. `--include-transcripts` opts back in.
  - `--deploy=github` builds a manifest (remote, branch, run count, PRD item
    count, transcript inclusion) and asks before doing any work. Without a TTY
    it stops with exit 1 unless `--yes` is passed — nothing is written or pushed.
  - `ndx init` and `ndx export` both add `ndx-export/` to `.gitignore`; the
    shipped template carries it too. `ensureGitignoreEntry` moved to
    `packages/core/gitignore.js` so both callers share it.
  - The dashboard's `POST /api/commands/export` forwards `--yes` only when the
    body carries `confirmDeploy: true` (set by the viewer's confirmation step)
    and refuses a deploy request without it; `includeTranscripts: true` maps to
    `--include-transcripts`. The confirmation dialog now says what is published.
  
  Found by the 2026-09-11 adversarial security review (finding B).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the dashboard's hench-config gate accepting values hench's schema rejects.
  
  `validateFieldValue` (`hench-config-fields.ts`) is the single gate for the three
  routes that write `.hench/config.json` — `PUT /api/hench/config`,
  `POST /api/hench/adaptive/apply`, and `POST /api/hench/adaptive/override` — but
  it was looser than hench's `HenchConfigSchema` in three ways. Enum fields were
  checked via `String(value)`, so `provider: ["cli"]` coerced to `"cli"` and an
  array was written where `z.enum` expects a string. Array fields were checked with
  `Array.isArray` alone, so `guard.allowedCommands: [1, null]` passed a
  `z.array(z.string())` field. Number fields rejected only negatives and `NaN`, so
  `0` was written to `guard.commandTimeout` (`z.number().positive()`) and JSON
  `1e999` was accepted as `Infinity`, which `JSON.stringify` then wrote as `null`.
  Each case returned 200 and produced a config hench refuses to load, so the next
  `ndx work` would not start until the file was hand-edited.
  
  The gate now requires a string before an enum lookup, requires every array
  element to be a string, requires `Number.isFinite`, and honours two new
  `ConfigFieldInfo` flags — `positive` and `integer` — that mirror the `.positive()`
  and `.int()` refinements on the matching hench field. A new cross-package
  contract test (`tests/e2e/hench-config-gate-contract.test.js`) probes every
  writable field against both definitions and fails if the gate ever accepts
  something `HenchConfigSchema` rejects, so the two cannot drift again silently.
  
  Found by the 2026-09-15 adversarial review (task 0a85aec1).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Hench Runs view aggregates runs across worktrees. `GET /api/hench/runs` (and `/runs/:id`) accept `?scope=repo`, merging every worktree's `.hench/runs/` and tagging each run with `{ name, path, branch }`; the default scope is unchanged. A lazily registered `fs.watch` per other-worktree runs directory keeps `hench:run-changed` firing for runs written elsewhere. The viewer requests repo scope, shows a mono worktree chip on each card when runs span more than one worktree, and adds a worktree filter.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start --hub` now writes `.n-dx-web.port` (the hub's port) and `.n-dx-web.pid` (`{ pid, port, startedAt, via: "hub", projectId }`) in the started directory, so `ndx refresh --live-server` keeps working unchanged: its reload signal reaches the hub, which forwards it to the project's own server. The reload body now carries `dir`; with several projects registered the hub matches it against each project's repository root and worktrees (deepest match wins), answering 409 without a directory and 404 for an unregistered one. `ndx start stop`, `ndx start status` and refresh's pre-flight recognise the hub marker and never stop the hub through it; `ndx start --here` over a marker takes the files over instead of killing the hub.

- [#358](https://github.com/en-dash-consulting/n-dx/pull/358) [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the local (LM Studio) per-request timeout configurable via `llm.local.timeoutMs`
  
  Local completions were bounded by a hardcoded 5-minute abort in three places — the
  local API provider, hench's local tool loop, and the second-model verifier (60 s) —
  so a slow local model failed with `NDX_CLI_TIMEOUT` no matter what the CLI-timeout
  settings said. `cli.timeoutMs` / the "CLI Timeouts" page bound a whole command, not
  an individual HTTP request, so setting them to unlimited had no effect on this path.
  
  All three now read `llm.local.timeoutMs` (default 300000, `0` = no timeout), settable
  via `ndx config llm.local.timeoutMs <ms>` or the LLM Provider settings page. The
  timeout error message now names the key to change.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx which [dir]` — report which copy of n-dx is actually running.
  
  The package version is the same string in every checkout and every install, so `ndx --version` cannot distinguish a globally installed `ndx` from the worktree you are standing in. `ndx which` prints five fields instead: the version, the absolute path of the `cli.js` executing, the install kind (npm registry install, pnpm global link, or workspace checkout), the branch and short SHA of the install checkout when it is a git working tree, and the resolved project directory. `--json` emits the same record as one object, and `ndx --version --verbose` prints the identical report.
  
  Install kind distinguishes a globally linked checkout from one invoked directly by comparing `process.argv[1]` against the realpathed entry point — Node leaves the former as the symlink, so a global bin shim makes the two disagree. The command always exits 0: a missing `git`, or an install that is not a working tree, reports no git identity rather than failing.
  
  `which` is registered in `ndx --help`, has its own `ndx which --help` page, and appears in the dashboard's All Commands view under Setup — ungated, since identifying the CLI is most useful on a project that is not initialized yet.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Cap request body size on the dashboard server.
  
  `readBody` concatenated every chunk with no limit, so a local process (the
  server is loopback-only) could POST a multi-gigabyte body to any route and
  drive it out of memory before the handler ran.
  
  A new `MAX_REQUEST_BODY_BYTES` (10 MB — the largest legitimate body is a PRD
  bundle import) is enforced in two places: `handleRequestSecurity`, which runs
  first for every request, answers `413` and destroys the connection when the
  declared `Content-Length` exceeds the cap (before any buffering); and
  `readBody`, which stops buffering, destroys the request, and rejects if a
  chunked body with no declared length streams past the cap. `jsonResponse` is
  now a no-op once the response is committed, so a route that already answered
  cannot double-write.
  
  Found by the 2026-09-11 adversarial security review (finding H).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the Sessions tray: a third bottom-right pill — "3 worktrees · 1 running" — expanding into a row per worktree with its name (anchor starred), branch, dirty count, and either the run in flight with a ticking elapsed time or the last one with its status, linking through to that run in the Runs view. Read-only: it does not switch the dashboard's workspace. Hidden outside a git repository and in a single-worktree one.
  
  `GET /api/worktrees` gains `runs.latest` — the running run that started most recently, else the most recently finished one — with the id, status, task title and timestamps the tray shows.
  
  Move `formatSince` from the Workspaces view to `viewer/utils/format.ts`, now that the tray is its second consumer.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The dashboard shows cross-worktree task claims. New read-only `GET /api/rex/claims` lists the live claims in the repository's shared store, with each task's title from the served PRD and the claiming worktree. PRD tree rows carry a "claimed · <worktree>" chip ("here" when this checkout holds it), and the Sessions tray lists the tasks each worktree has claimed under its row. Both refresh on the poll tick and on `hench:run-changed`, so a claim appears within one interval and disappears when released.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - The sidebar footer now shows which n-dx is running: `n-dx <version> · <install> · <project>`, with the full CLI and project paths in its tooltip. It reads the `server` object that `GET /api/config` already returns and that the viewer already fetches before its first render, so there is no extra request, and it renders on every view without waiting for the configuration panel's own fetch. A server too old to send the object renders no identity line.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - A dashboard can now see the hub's admission queue. `GET /api/hub/queue` is answered under a project prefix too (`/p/<id>/api/hub/queue`), which is the only address a viewer has — its fetches are rewritten to sit under the page's base path, so the hub's own API was previously unreachable from the page the hub serves. Asked that way, the queued entries are scoped to that project while the running count, limits and memory state stay machine-wide, since waiting behind another project's run is exactly what needs explaining. A new `useHubQueue` hook polls it, tolerating the single-project server where no hub answers.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - An over-cap chunked request body now gets an HTTP 413 instead of a reset connection. `readBody` used to destroy the request the moment the streamed cap was passed and leave the answering to the caller's `catch` — which could not work, because destroying the request destroys the socket, so the 400 was written into a closed connection and the client received zero bytes and an EPIPE. It now sends the same 413 the Content-Length guard sends, closes cleanly, and still rejects so callers keep their existing `catch` (which no-ops once the response is committed). Only clients that send chunked bodies without a Content-Length were affected; the dashboard always sends one.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `GET /api/workspaces/:key/prd-delta`: how a worktree's PRD differs from the anchor's, computed server-side by item id — `onlyHere`, `onlyAnchor`, `changed` (status, title, priority, description or lastModified differ) and `completedHere` — with exact counts, id lists capped at 500 (`truncated` flag), and `identical` for trees that match. Cached per (anchor, workspace) pair and invalidated by either tree's rex watcher.

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Reject cross-origin WebSocket upgrades on the dashboard server.
  
  A WebSocket handshake carries no CORS preflight, so the HTTP-side
  `handleRequestSecurity` guard never saw it — the `upgrade` handler checked only
  for a `Sec-WebSocket-Key`. While `ndx start` ran, any page open in the user's
  browser could `new WebSocket("ws://localhost:<port>")` and receive every
  broadcast: PRD changes, `hench:task-execution-progress` (which carries the
  agent's last stdout line), execution and memory state. Inbound frames are
  limited to close/ping/pong, so this was a passive read, but the only
  cross-origin hole in an otherwise well-guarded server.
  
  `handleUpgrade` now applies the same origin check the HTTP guard uses
  (`isTrustedBrowserOrigin`, exported for this): a present `Origin` must be this
  loopback server's own (compared against the socket's local port, so a
  DNS-rebinding Host cannot match), or the upgrade is answered `403 Forbidden`
  and the socket destroyed before any client is registered. A missing `Origin`
  (non-browser CLI/MCP clients) stays allowed, matching the HTTP guard's contract.
  
  Found by the 2026-09-11 adversarial security review (finding E).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Allowlist the config keys `POST /api/hench/workflow/apply` may write.
  
  The endpoint applies machine-generated workflow suggestions, but
  `handleApplySuggestion` wrote whatever keys the request named into
  `.hench/config.json` with no allowlist and no value check. A same-origin caller
  could set `guard.allowedCommands`, `guard.blockedPaths: []`, or
  `permissionMode: "bypassPermissions"` — and the next hench run would inherit
  them (arbitrary commands, no path sandbox, permissions bypassed) — or use a
  `__proto__` path segment to poison the prototype chain.
  
  `apply` now validates `changes` against `APPLYABLE_SUGGESTION_KEYS` — the exact
  set the suggestion generator emits (`tokenBudget`, `maxTurns`,
  `retry.maxRetries`), each required to be a nonnegative integer — before preview
  or any write, so a rejected request (400) leaves the config file untouched. Path
  segments `__proto__`/`constructor`/`prototype` are refused, and the module's
  `setNestedValue` drops them as defense in depth. A test pins the allowlist to
  the keys the generator actually emits so the two cannot drift.
  
  Found by the 2026-09-11 adversarial security review (finding F).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Build lazily-created workspace contexts' `svDir`/`rexDir` with `path.join` instead of `/` string concatenation, so non-anchor worktree paths use native separators on Windows (the PRD lock and store resolution key off `rexDir`, where a mixed-separator spelling risks cache and lock misses).

- [#369](https://github.com/en-dash-consulting/n-dx/pull/369) [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the dashboard's workspace-scoped PRD writes explicit. The PRD view now shows a one-line strip naming the workspace whenever it is not the anchor ("Workspace <name> · writes go to this worktree's PRD"), so an edit made while viewing a branch worktree states its target rather than leaving it to be inferred from the URL. There is still no cross-workspace write action — switching to the anchor's PRD is a workspace switch. Adds an integration test that hashes both worktrees' trees around a write through `/w/<key>/api/rex/items` and a slot-less write, pinning that each lands in exactly one tree.
- Updated dependencies [[`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`6e44977`](https://github.com/en-dash-consulting/n-dx/commit/6e44977a9984998a11587194ab8ad25e38a53b59), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d), [`f4ab3bb`](https://github.com/en-dash-consulting/n-dx/commit/f4ab3bbc072e1f99b860cfa0e3d306bf80d92fc3), [`9fd0ce7`](https://github.com/en-dash-consulting/n-dx/commit/9fd0ce7b388cffcd1d6f15fa10683756f363b44d)]:
  - @n-dx/rex@0.7.0
  - @n-dx/llm-client@0.7.0
  - @n-dx/sourcevision@0.7.0

## 0.6.0

### Patch Changes

- [#366](https://github.com/en-dash-consulting/n-dx/pull/366) [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the caller's project directory instead of inheriting the server process's own cwd.
  
  `createLLMClient`/`createClient` now accept an optional `cwd`, threaded through to `cli-provider.ts`'s `spawnCli` call. The dashboard's Ask route (`routes-sourcevision-ask.ts`) passes `ctx.projectDir`, so an Ask request run against a different project no longer executes the CLI wherever `ndx start` happened to be launched from. Hench's own spawn path already passed `cwd` and is unchanged.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Enforce `sourcevision.ask` on the endpoint, not just in the viewer.
  
  `POST /api/sourcevision/ask` now refuses with `403` and `kind: "disabled"` when
  the toggle is off. Gating only the viewer made the toggle a property of one
  client: the panel hid itself while anything else that could reach the port
  still spent the project's tokens, which is the one consequence the toggle's
  impact text names.
  
  - **Checked before the body is read and before the analysis is loaded**, so a
    disabled project is told the feature is off rather than told about whichever
    other precondition it also happens to be missing.
  - **Fails closed.** A missing `.n-dx.json`, an unparseable one, or a key absent
    from the registry all resolve to the registry default — `false` for Ask. A
    gate that opens when it cannot tell is not a gate.
  - **Read per request, not cached.** Toggles are edited from the dashboard while
    the server runs; a value read once at startup would keep refusing after the
    user enabled it.
  
  New `isFeatureEnabled(projectDir, key)` in `routes-features.ts` is the shared
  reader. `disabled` is a first-class `AskErrorKind` with its own status, fallback
  wording, and entry in the panel's per-kind presentation table, so the card names
  the fault and points at the Feature Toggles view instead of rendering a bare
  403. `askFailureKindFromStatus` deliberately does not mirror 403 back to
  `disabled`: our own 403 carries its kind in the body, and a foreign 403 is an
  access denial.
  
  This diverges from `sourcevision.prMarkdown`, which stays viewer-gated. The
  difference is deliberate — that page renders from analysis already on disk,
  while each Ask call spends tokens. The two `/api/rex/*` routes the panel uses
  (`capture-ask`, `apply-refinements`) are not gated: they belong to the rex
  scope and neither one calls a model.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Attribute SourceVision Ask token spend in the LLM Utilization view
  
  Every Ask call spent real tokens from a surface with no accounting path. Hench
  runs land in `.hench/runs/` and roll up per PRD item; rex and sourcevision
  report through their own artifacts. The dashboard's own spend reported nowhere,
  so the one view whose job is to report the bill was blind to its own.
  
  Each call is now appended to `.n-dx-web-usage.jsonl` with vendor, model, input,
  output, cache-creation and cache-read tokens, plus how the call ended. The
  utilization aggregation reads it as a fourth package bucket, `web`, rendered as
  "Dashboard" — its own colour, donut slice, filter option and command row, so it
  stays separable from hench run spend everywhere the view breaks down by
  package. Asks are not task-scoped, so the spend is a dashboard bucket rather
  than being attributed to whichever PRD item happened to be selected.
  
  Failed calls are recorded too, with the call counted and whatever the provider
  reported. A provider that finishes after the ask timed out appends its counts
  as a second, call-free record, so late tokens are neither lost nor
  double-counted as a second call. A call that never reached a provider (no
  analysis, unconstructible client) is deliberately not recorded — the ledger
  counts calls, not intentions.
  
  Cache tokens are now reported in this view rather than hidden, consistent with
  the hench/rex decision. The server had always counted and priced them
  (`estimateCost` charges cache writes at 1.25x input and reads at 0.1x), but the
  viewer's local copy of the wire shape omitted the fields and totalled only
  input + output — so "Total Tokens" disagreed with the "Est. Cost" beside it, and
  on a cache-heavy run most of the bill had no visible line. Cache write/read now
  appear as headline figures, as columns in the vendor-model and command tables,
  and as their own cost lines.
  
  The aggregation cache also fingerprints the ledger, so an answer's cost appears
  without waiting for an unrelated source to change.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Gate the Explain action on the `sourcevision.ask` toggle.
  
  `sourcevision.ask` is experimental and defaults to off, and its impact text says
  each question spends tokens. The tab list and the sidebar both honoured it; the
  **Explain** button on Problems and Suggestions rows did not. On a default
  install that left Ask fully reachable — finding row → Explain → panel → submit →
  tokens — through the one entry point that is not in the sidebar, while the only
  control that could turn it off is hidden by the very toggle that is off.
  
  Both views now take the toggle as a prop and omit the action when it is false,
  on the same branch that already omitted it when the surface has nowhere to
  navigate. The prop defaults to `false`, so a call site that forgets it renders
  no button rather than an ungated one.
  
  The toggle is read in `main.ts` rather than in the views: the view-registry
  renderers are plain functions dispatched by view id, so a hook called inside one
  would be a conditional hook in `App`, and Problems and Suggestions both return
  early from an enrichment gate before their own hooks run.
  
  Tests cover the button's absence in both views with the toggle off and with the
  prop omitted, plus the registry wiring that supplies it — dropping the prop
  there would have restored the old behaviour with every component-level
  assertion still passing.
  
  The endpoint enforces the same toggle — see the separate changeset for
  `POST /api/sourcevision/ask`.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Call every hook before the enrichment gate in all three gated SourceVision views.
  
  Architecture, Problems and Suggestions each return an `EnrichmentGate` early when
  the analysis has not reached their threshold, and then called `useMemo` below it.
  `enrichmentPass` is loaded data — 0 on the first render, real once the data
  arrives, and different again when an analysis finishes with the dashboard open —
  so the early return is taken on some renders of the same mounted component and
  not others, and every hook below it was conditional. Preact matches hooks by
  position and, unlike React, does not warn: the slots simply shift.
  
  All three now call their hooks first and gate afterwards. In Problems and
  Suggestions `findings` is memoized on the source array while moving, which also
  makes the memo that keys on it work at all — a fresh array each render meant it
  recomputed every time. Architecture needed only the one memo hoisted; nothing
  there keys on `findings`, so it stays a plain filter below the gate.
  
  The invariant is pinned structurally, by asserting no view calls a hook after its
  early return. A behavioural test cannot fail on this defect: the conditional
  hooks were appended after the stable ones, so nothing is misread today and the
  exposure is to the next edit. Transition tests cover the other half — crossing
  the threshold in both directions, repeatedly, renders what it did before.
  
  The guard's view list is itself checked against the directory, so a view that
  renders an `EnrichmentGate` cannot be added without being covered. That gap is
  why Architecture was missed the first time: the list was hardcoded to two
  entries while the suite claimed to check every gated view.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Guard the `NDX_CLI_PATH` rung of the ndx binary ladder, and document it.
  
  `resolveNdxBin` had an undocumented first rung — `NDX_CLI_PATH` returned
  verbatim, above every rung its doc comment described, and without the
  `existsSync` check its twin `N_DX_CLI_PATH` has. Two names for one fact:
  `packages/core/cli.js` assigns both to its own path on startup, so a server
  started by `ndx start` carries both.
  
  - **Both env rungs are now guarded.** The value is exported to every child of an
    `ndx` process, so it outlives the install that wrote it. A dev-link install
    that moved or was uninstalled left a path that no longer exists, and rung 1
    spawned it anyway — `node <missing file>`, where the rungs below it would have
    resolved.
  - **The ladder is documented as five rungs**, including why there are two env
    names and that the launcher currently outranks the analyzed project's own
    `node_modules/.bin/ndx`. The prose ladder in `routes-hench.ts` named only
    `NDX_CLI_PATH`; the doc comment named only `N_DX_CLI_PATH`. Neither was
    complete.
  
  The ladder tests now cover rung 1 — that it beats both the project-local bin and
  `N_DX_CLI_PATH`, and that a stale value falls through. An ambient `NDX_CLI_PATH`
  answering silently from rung 1 is what left the rungs below it asserting nothing,
  which is how the unguarded return stayed invisible: the suite was red for anyone
  running it from a session `ndx` had launched, and green in CI, which sets neither
  name.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Resolve a requested port of 0 to a real ephemeral port instead of returning the literal 0.
  
  `findAvailablePort(0)` probed port 0 through `checkPort`, whose result is
  platform-dependent: on Linux the connect probe fails `ECONNREFUSED`, the bind
  phase then succeeds (binding 0 always does), and the literal 0 came back as
  the allocated port — `startServer` then logged it, wrote it to the port file,
  and returned it to callers as a port no client can connect to. Windows masked
  the bug by failing the connect probe with `EADDRNOTAVAIL` and falling through
  to the ephemeral allocator, which is why the scoped-route-dispatch integration
  test passed on Windows and died at boot on Linux CI. Port 0 now takes the
  ephemeral allocator directly on every platform, which also skips the pointless
  retry backoff Windows paid while probing it.
  
  Also stops the server calling that resolution a fallback. `PortAllocationResult`
  gains `isFallback` — the request could not be honoured, so a different port was
  substituted — which is deliberately not the inverse of `isOriginal`. For port 0
  the bound port is not the number asked for (`isOriginal: false`) but the request
  was satisfied exactly, so nothing fell back. Both consumers read `!isOriginal`
  and were wrong: the operator saw `Port 0 is in use — using port 54321 instead.`
  about a port that was never in use, and `StartResult.isFallback` told a caller
  that had asked for an ephemeral port it got a fallback. Both now read
  `isFallback`, so a third consumer is correct by default. `isOriginal` keeps its
  documented meaning and its value in every case.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Write only the three known fields when applying a PRD refinement.
  
  `applyRefinements` spread the posted `updates` object into `updateInTree`, which
  is an `Object.assign`. The route's shape check never looks at `updates`
  (`isProposalShape` checks `op`, `id`, `itemId`, and `baseline`), `validateAgainst`
  checks only that it is non-empty and that `priority`, if present, is valid, and
  the TypeScript type is erased at runtime — so a crafted proposal carrying
  `status: "completed"` and `children: []` alongside an honest fingerprint and a
  diff declaring a description change applied all of it and reported `applied`.
  `validateDocument` inside the transaction does not catch that: a childless
  completed epic is schema-valid.
  
  `description`, `acceptanceCriteria`, and `priority` are now picked off `updates`
  individually, at the write, where the next person adding a refinement field is
  already looking.
  
  The model cannot reach this — `RawRefinementSchema` is non-strict so zod strips
  unknown keys, and `buildEdit` constructs `updates` field by field — and
  `request-security.ts` blocks cross-site browser mutations, so this is
  defence-in-depth rather than a closed exploit path. What made it worth fixing is
  that it contradicted the reason the route gives for its own body check being
  structural: that field legality is re-established under the lock. For staleness
  and mutation legality it is; for field scope it was not. That docblock now says
  so and points at where the scope is actually enforced.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Record which n-dx produced each hench run.
  
  Several checkouts are usually live at once — a worktree per in-flight PR plus a
  linked global install — and their run records were indistinguishable, so a token
  or outcome report could not say which build the numbers came from.
  
  `RunRecord` gains two optional fields, stamped at run start by `initRunRecord`
  and by `hench record`:
  
  - `ndxVersion` — `NDX_VERSION` when an orchestrator exports it, otherwise the
    `@n-dx/hench` manifest version.
  - `cliPath` — `NDX_CLI_PATH` / `N_DX_CLI_PATH` (exported by `packages/core/cli.js`),
    falling back to `process.argv[1]`.
  
  Both are additive: records written before the fields existed load unchanged, and
  the dashboard's run detail renders each row only when its value is present. A
  failed manifest read is not memoized, so one transient error cannot pin every
  later run in the process to a missing version.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - SourceVision Ask: give each degraded mode a specific, actionable message.
  
  The panel's failure card now names the mode it is in rather than reporting
  "The Ask request failed (502)". Missing analysis offers the analyze/refresh
  control itself instead of naming a command; credential failures render
  `@n-dx/llm-client`'s canonical `authFailureGuidance` remediation, ending in
  `VERIFY_CREDENTIALS_STEP`, sent from the endpoint as a new `remediation` field;
  timeout, rate limit, and provider error are each reported as themselves, with a
  retry offered for the two that are transient and the vendor's own retry delay
  stated when it supplied one. The prompt survives every failure.
  
  The endpoint also stops describing one failure while coding another: a typed
  provider error whose message carries no classifiable text now takes its wording
  from the kind it resolved to.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the SourceVision Ask panel usable without sight or a mouse.
  
  An async text exchange has one accessibility requirement the other
  SourceVision subviews do not: the answer arrives after an indeterminate delay,
  so it has to be announced rather than merely rendered. Four defects followed
  from that, and each is now fixed and pinned by a test in
  `tests/unit/viewer/ask-view-a11y.test.ts`.
  
  - **Arrival was not reliably announced.** The answer card was itself the live
    region, so the region came into existence in the same render as its content —
    which screen readers do not reliably announce. There is now one persistent
    polite region, mounted with empty text while idle, and the answer card is a
    `role="region"` labelled by its heading. The test asserts *node identity*
    across the transition, because an equal-looking replacement would satisfy a
    presence check and still fail a reader.
  - **Arrival announced the whole answer.** A live region reads its entire text,
    so a 400-word answer buried the one fact the waiting user needed and talked
    over whatever they were reading. The region now reports that the answer is
    ready, how long it is, and where to find it; the answer is read on demand.
    Making the card live also meant a live *ancestor* claimed every descendant
    update, so each later "Copied" line re-read the answer with it.
  - **Submitting stole focus.** The textarea and the submit button were both
    `disabled` while the request was in flight, and the browser blurs a disabled
    element — so pressing Enter in the prompt, or Enter on the button, dropped
    focus to `<body>` and left a keyboard user at the top of the document for the
    length of an LLM call. The textarea is now `readOnly` and the button carries
    `aria-disabled`; `submit()` already refused the second request, so nothing
    needed to be disabled to prevent one.
  - **Success and failure differed only in hue.** Both feedback lines now carry a
    shape marker as well as a colour, and a capture failure adds a
    screen-reader-only "Capture failed:" prefix — its message comes from the
    server and may state a fact ("PRD is locked by pid 4212") that does not read
    as a failure on its own.
  
  The panel also joins the axe-core audit (idle and deployed-mode states, light
  and dark), and `docs/accessibility.md` gains the behavioural-suite table that
  records what axe cannot check.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Wire Copy and Capture-to-PRD actions onto a SourceVision Ask answer
  
  Two controls under an answer, plus one shared clipboard module and one new PRD
  write route.
  
  **Copy reuses the PR Markdown view's path rather than reimplementing it.** The
  copy attempt, the `execCommand` fallback, the permission-denied classification,
  and the user-facing wording all move to `viewer/utils/clipboard.ts`, which the
  Ask panel and `pr-markdown.ts` now share — two consumers, so it clears the
  two-consumer rule without becoming a single-consumer module. `copyTextToClipboard`
  returns a discriminated result (`{ok: true}` or a named `reason`), so the
  branching lives in one place: the modern API is skipped entirely when absent
  rather than called and allowed to throw, and a fallback that succeeds reports
  success whatever the first attempt's reason was. The four PR Markdown strings
  are reproduced byte-for-byte and pinned by a test, so a permission denial reads
  identically on both surfaces.
  
  **Capture is confirm-guarded, and says where the item landed.** The first press
  only arms the action; nothing is written until Confirm — the shape the Overview
  Next Steps panel uses, and for the same reason. `POST /api/rex/capture-ask`
  files the exchange as a **task** under a find-or-create "SourceVision Ask"
  epic (`LEVEL_HIERARCHY` accepts a task under an epic, so no filler feature has
  to be invented), and the response names the created item, its parent, and
  whether the epic is new — "Captured to PRD" alone leaves the user hunting for
  what they just filed.
  
  **Deliberately no title dedup, unlike `capture-next-steps`.** There the same
  recommendation recurs on every analysis and skipping it is a kindness; here the
  user pressed Confirm on this specific answer, so discarding the write because
  they once asked something similar would be a capture that reports success and
  files nothing. Repeat presses are guarded by the confirm step plus an in-flight
  ref instead.
  
  A failed capture surfaces the endpoint's own reason in an `alert` region and
  leaves the answer intact and re-copyable. Both kinds of feedback are transient
  and both are dropped when a new question is submitted — including when that
  question fails — so a "Copied" or "Captured" line can never be read as
  belonging to an answer it did not come from. Capture's window is five times
  Copy's, because its message names a destination the user needs time to read.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `POST /api/sourcevision/ask`, answering a question from the existing analysis
  
  The SourceVision Ask panel's server half. The request is
  `{ prompt, seed? }` validated by a zod schema; the response is
  `{ answer, vendor, model, tokens, contextSources }`.
  
  **Bundle, not a tool-use loop.** Context is pre-assembled from the
  `.sourcevision/` artifacts already on disk — manifest, inventory, imports,
  zones, findings, derived next steps, component count, and a `CONTEXT.md`
  excerpt — and sent in a single non-agentic call. A loop that queried lookups on
  demand would answer a wider range of questions, but at an unbounded number of
  round trips per question and with no way to test what the model actually saw. A
  unit test now asserts the assembled facts reach the completion request, which is
  the property the whole endpoint rests on. Every section is capped and reports
  what it cut, so the bundle does not grow with the repository until the vendor
  rejects it as an opaque 400.
  
  **Analysis is the only ground truth.** The endpoint reads no source, and refuses
  with `no_analysis` rather than letting the model answer from its priors when
  nothing has been analysed. All sourcevision access — including the five artifact
  schema types the reads are parsed against — goes through
  `server/domain-gateway.ts`; the gateway's export cap moved 15 → 16 with that
  reason recorded.
  
  **Named failures, and it cannot hang.** Vendor and model come from the project's
  own config via `loadLLMConfig` + `resolveTaskModel` (new `sourcevision.ask`
  class, standard tier, reroutable through `llm.routes`), and the pair that served
  the call is reported back so the panel never has to guess which model produced
  an answer. The call races a budget — `sourcevision.ask.timeoutMs`, default 120s,
  also passed down so a CLI-mode child bounds itself — and every failure returns a
  named `kind` (`timeout`, `rate_limit`, `auth`, `network`, `no_analysis`,
  `invalid_request`, `llm_error`) with the vendor's retry delay when it supplied
  one, instead of a generic 500. A provider that already threw a typed
  `ClaudeClientError` is trusted over re-classifying its message, so a 429 the
  provider knew about is never downgraded to `unknown`.
  
  The task-class registry contract test now scans `web` as well as the three
  domain packages: web declares classes now, and an unregistered one there
  resolves silently to the standard tier exactly as it would anywhere else.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Explain a SourceVision finding in plain language from the Problems and
  Suggestions views.
  
  Every finding row now carries an **Explain** action that opens the Ask panel
  with that finding attached. What travels is the finding's own fields — type,
  severity, zone, message, and related files — as a structured `seed` beside the
  prompt, not a pre-written sentence. That distinction is the feature: facts in
  the question text would be deleted the moment the user reworded it, and a
  prompt is not something the endpoint can render as a focus section or reason
  about.
  
  The endpoint already accepted a loose `{kind, id, text}` seed. It now also
  takes `zone`, `files`, and a `labels` map, renders them as their own facts, and
  — only when a seed produced a focus section — adds three rules requiring the
  answer to name that finding's zone and files and to state what a fix would
  touch. An explanation that could have been written without reading this
  repository is the failure mode, so the extra rules say so outright.
  
  Details worth knowing:
  
  - **Nothing is defaulted on the way through.** A finding with no severity sends
    no severity; the list view's "treat missing as info" grouping default stops at
    the display layer, because telling a model the analysis classified something
    it did not classify is inventing the field the explanation reasons about.
    A `global` finding sends no zone rather than the string `"global"`.
  - **The seed is shown as well as sent, and can be detached.** An answer naming
    files the user was never shown reads as a guess; a seed that could not be
    removed would silently ground every later question in whichever finding they
    arrived from.
  - **Explain is opt-in per surface.** `FindingsList` also renders for the
    Architecture view, which has nowhere to send a finding, so the action appears
    only where a navigation target exists. The button sits outside the row header
    because that header is itself a button whenever a finding has related files.
  - The seeded answer supports the same Copy and Capture-to-PRD actions as any
    other, and an unknown `seed` field is still rejected rather than dropped — a
    client that guessed the shape is told, not quietly answered without it.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the gated SourceVision "Ask" tab and its prompt/response panel
  
  The client half of the Ask panel: a tab in `SOURCEVISION_TABS` behind the
  default-off `sourcevision.ask` feature flag, and a view registered in
  `view-id.ts`, `view-routing.ts`, and `view-registry.ts` so `/ask` deep-links and
  survives a reload like every sibling tab. The panel owns the labelled prompt
  textarea and the submit control, and consumes `POST /api/sourcevision/ask` — it
  assembles no context and calls no model itself.
  
  **One state value, not three booleans.** `idle | submitting | answered | error`
  is a discriminated union. The `loading`/`error`/`data` triple the older views
  use admits eight combinations for four legal states, and the illegal ones
  ("submitting and answered") are exactly the renders that read as a bug to
  someone waiting on an answer.
  
  **An empty prompt is not a request.** A whitespace-only prompt disables the
  submit control *and* returns early from the handler an Enter keypress reaches,
  so it never costs a round trip to be told you typed nothing. A concurrent
  submit is refused through a ref rather than through `state.status`, which has
  not been applied yet when a double click's second handler runs. A 200 carrying
  an empty answer is reported as an error rather than rendered as a blank card.
  
  **`requiresServer`, so a static export hides it.** The answer is an on-demand
  LLM call and `ndx export` has no such route — deployed mode's fetch adapter
  answers every non-GET with a 405 — so the tab is hidden there and the view
  renders the explanatory card instead, matching the isometric map's contract.
  
  Copy/Capture actions on the answer, per-failure-mode wording beyond what the
  endpoint supplies, and seeding the prompt from a finding are separate tasks
  under the same feature; the shell is shaped so each lands in one place.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Stamp `lastModified` on tree mutations made inside `store.withTransaction`.
  
  Only the single-item store methods (`addItem`/`updateItem`/`removeItem`)
  stamped. Every batch write mutates the tree directly inside a transaction and
  so bypassed them: the dashboard's bulk update and merge routes, the Ask panel's
  apply-refinements, and the CLI restructurers. The item was written to disk
  looking untouched.
  
  That is silent in both directions. `isModifiedSinceSync` asks whether
  `lastModified > lastSyncedAt`, so a previously-synced item whose stamp never
  advanced is skipped on push; `resolveConflicts` then does last-write-wins on
  local versus remote time, and with the local time stale the next
  `sync_with_remote` overwrites the local change with the remote's value. Nothing
  reports either half. Reachable on any project configured with a remote adapter.
  
  The stamp now belongs to the transaction rather than to each caller —
  `FileStore.withTransaction` and `FolderTreeStore.withTransaction` signature the
  tree before running the callback and stamp whatever changed, via
  `snapshotItemContent` / `stampChangedItems` in `core/sync.ts`.
  
  Deliberate details:
  
  - **Changed, not merely present.** `migrate-slugs` and `reshape` each open an
    empty transaction purely to force a rewrite; stamping unconditionally would
    mark every item in the PRD modified and queue the whole tree for push.
  - **A parent whose child list changed counts as changed**, which is what
    `removeItem` already did by hand for exactly this reason.
  - **A stamp the item arrived with is kept.** `analyze.ts` stamps its accepted
    items before opening its transaction, deliberately; only an item that is new
    to the tree *and* unstamped gets one here.
  - **Sync bookkeeping is excluded from the signature** (`lastModified`,
    `lastModifiedBy`, `lastSyncedAt`, `remoteId`) — including any of them would
    make a stamp, or a recorded sync, look like a further modification.
  - **The actor is resolved before the lock is taken.** `resolveActor` shells out
    to `git config` on first call; doing that inside the locked span puts a
    subprocess between every other writer and the PRD.
  
  The remote adapters keep their own lock-free `withTransaction` unchanged: they
  push to systems where these timestamps mean something different.

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx start` asks who is on the port before killing it, and steps aside for another project's dashboard.
  
  The PID file `runWeb` consults lives inside the directory it was given, so a
  second project or worktree had no entry there. A busy 3117 therefore read as a
  stranger squatting on the port and `killPortOccupant` SIGKILLed it — including
  when the occupant was another project's working dashboard. The server's own
  fallback allocator (`findAvailablePort`, 3117–3200) never got a chance to run,
  because the orchestrator killed first.
  
  A busy port is now probed with a 1.5 s `GET /api/status` before anything is
  killed:
  
  - an n-dx dashboard reporting a **different** `projectDir` is left alone, and
    this invocation moves to the next free port in 3117–3200;
  - an n-dx dashboard reporting **this** directory is restarted as before — that
    is `ndx start`'s documented idempotency, reached here when the PID file is
    missing;
  - anything else, including a dashboard too old to report `projectDir`, keeps
    today's behaviour exactly. An inconclusive probe never widens the kill.
  
  `GET /api/status` gained a top-level `projectDir` so the probe has something to
  attribute the server by. Purely additive.

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - GET /api/status and GET /api/config now include a `server` object — `projectDir`,
  `version`, `cliPath`, `pid`, `port`, `startedAt` — identifying the running dashboard
  process itself, not just the project it serves. `version` and `cliPath` come from the
  same resolution the dashboard already uses to spawn `ndx` commands (`@n-dx/web`'s own
  `package.json`, and the `NDX_CLI_PATH`/`N_DX_CLI_PATH` env vars set by `cli.js`), so
  `ndx which`/the viewer footer can report them without re-deriving them. Purely
  additive: existing fields on both routes are unchanged.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - fix(web): retry readWebVersion() after a transient read failure
  
  `readWebVersion()` (used by GET /api/status and GET /api/config's `server`
  object) memoized its own failure: a read of `packages/web/package.json`
  that fails transiently — EMFILE under descriptor pressure, a slow mount not
  yet ready during a startup burst — assigned the sentinel `"unknown"` to the
  module-level cache, and the truthy check on re-entry then returned
  `"unknown"` for the life of the process even once the file was readable
  again.
  
  The catch path now returns `"unknown"` without populating the cache, so the
  next call retries. A successful read is still memoized permanently, since
  the file does not change under a running process.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Define the monospace token the viewer's panels ask for, and repair three that existed nowhere
  
  `--mono`, `--line` and `--panel2` were referenced without a fallback in `pr-markdown.css` and `commands.css` and defined in no stylesheet, so those declarations were dropped: the markdown and command panels rendered in the inherited sans stack, on transparent surfaces, with no borders. They now point at `--font-mono`, `--border` and `--bg-surface`.
  
  `--font-mono` is newly defined. Eight other stylesheets already referenced that name through a `monospace` fallback, so they were getting the fallback rather than the intended stack.
  
  A test now asserts that every token used without a fallback resolves. The viewer carries a backlog of these — `llm-provider.css` is written against a `--color-*` / `--spacing-*` scheme the project never adopted — which the test allowlists rather than fixes, since choosing replacement values is a visual decision. The allowlist is itself checked for staleness, so an entry that gets defined has to be removed rather than quietly granting permission to break it again.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop an out-of-scope POST to `/api/sourcevision/ask` from killing the server.
  
  `handleApiRoutes` gated the ask route with
  `handleScopedRoute(isInScope(...), handleSourcevisionAskRoute(req, res, ctx))`.
  The second argument is a value, so the handler was invoked before the guard was
  read. With `--scope=rex` (or any scope excluding sourcevision) the handler ran
  anyway, reached the model call, and then wrote to a response the dispatcher's
  404 fall-through had already finished — throwing `ERR_HTTP_HEADERS_SENT` from an
  unawaited promise, which terminates the process on Node 22. One local POST took
  down the dashboard, having first paid for an answer nobody received.
  
  The scope check now happens before the handler is invoked, matching the
  synchronous siblings on either side of it.
  
  The eager-evaluation shape is not unique to this route — `handleScopedRoute` has
  it at every call site, and the same crash reproduces on `/api/notion/sync` under
  `--scope=sourcevision`. That is pre-existing and tracked separately; this change
  fixes only the route that reaches an LLM, and leaves a comment at the call site
  explaining why the guard is inline rather than delegated.
  
  Covered by `tests/integration/scoped-route-dispatch.test.ts`, which boots the
  real server in a child process — the existing ask-route tests mount the handler
  directly and never touch the dispatcher, which is why they passed throughout.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `handleScopedRoute` take a thunk, so an out-of-scope route cannot run.
  
  The helper took the handler's *result*, which meant every call site had already
  invoked its handler before the scope guard was read. On a false guard the
  promise was neither awaited nor cancelled: the handler ran on, wrote to a
  response the dispatcher's 404 fall-through had already finished, and threw
  `ERR_HTTP_HEADERS_SENT` from an unawaited promise — which ends the process on
  Node 22.
  
  Probing the previous build under `--scope` showed `/api/notion/*` and
  `/api/merge-graph` were reachable this way. The other scoped routes escaped only
  because they do not accept POST on the paths probed and so returned without
  writing — luck, not a guard, and it held whether or not the project was
  initialised.
  
  The parameter is now `() => RouteResult`, invoked only when the guard passes, so
  passing an already-invoked handler is a compile error (`TS2345`) rather than a
  latent crash. All eleven call sites are migrated, including the ask route, whose
  one-off inline guard from the previous fix is folded back into the shared
  mechanism.
  
  Also removes `resolveRouteResult`, a no-op ternary whose two branches were
  identical (`result instanceof Promise ? result : result`) and whose only caller
  was this helper — `await run()` covers both sync and async handlers.
  
  `tests/integration/scoped-route-dispatch.test.ts` gains cases for the two
  reachable routes; it boots the real server in a child process, because the
  per-route unit tests mount handlers directly and never touch the dispatcher.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - SourceVision Ask: propose and apply PRD refinements, reviewed as diffs and written under the store lock.
  
  A new opt-in refine mode sends the PRD with the question and lets the answer carry proposed changes to existing items — a rewritten description, replacement acceptance criteria, a different priority, a reparent, or a merge with a duplicate sibling. Each proposal renders as a before/after diff of exactly the fields it changes and is accepted or rejected on its own; rejecting issues no request at all.
  
  Accepted proposals go to `POST /api/rex/apply-refinements`, which applies them through the rex gateway's `resolveStore` inside `withTransaction`. A proposal whose item changed since the answer was generated is refused as stale rather than applied over the top of whoever changed it, and a PRD lock held by another writer fails the request loudly, naming the holder's PID.
- Updated dependencies [[`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`72609db`](https://github.com/en-dash-consulting/n-dx/commit/72609db1c4572f94ef25a2178d5cac2c17e241dc), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9)]:
  - @n-dx/rex@0.6.0
  - @n-dx/llm-client@0.6.0
  - @n-dx/sourcevision@0.6.0

## 0.5.2

### Patch Changes

- [#345](https://github.com/en-dash-consulting/n-dx/pull/345) [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae) Thanks [@endash-shal](https://github.com/endash-shal)! - Mark where the SourceVision Ask panel and its Rex/Hench siblings will land
  
  The PRD gained a "SourceVision Ask Panel" feature — a gated text exchange over
  the analysed project that can explain a finding in plain language and propose
  PRD refinements. The code side of this branch is markers only, no behaviour: a
  placement comment in `SOURCEVISION_TABS` for the gated `Ask` tab, plus adoption
  markers in `domain-rex.ts` and `domain-hench.ts` for the two surfaces that want
  the same panel afterwards.
  
  The Rex and Hench panels are intentionally absent from the PRD. The sequence is
  to build the SourceVision one, generalise it, then lift the shared piece out —
  so the markers record the intent (and, for Rex, that a panel there must reuse
  the existing `withTransaction` apply path rather than adding a second PRD write
  surface) without implying scheduled work.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Count and price cache tokens in every usage rollup.
  
  Run records carry four token fields — input, output, cacheCreationInput,
  cacheReadInput — but the rollups summed only the first two, and neither cost
  estimator priced the cache at all. On this repo `ndx usage` reported 1,212,931
  tokens and $18.00 across 1,024 runs; the same runs actually hold 668,969,084
  tokens and cost roughly $237.74. Cache reads alone were 662M of that, 99% of
  all tokens and completely invisible.
  
  Cache tokens are billed, not free: a write costs about 1.25x the input rate and
  a read about 0.1x. Dropping them did not make the estimate approximate, it made
  it wrong by more than an order of magnitude — and it hid the one number the
  cost work moves, since batching and warm-parent forking trade fresh input for
  cache reads.
  
  `PackageTokenUsage`, `AggregateTokenUsage`, and `TokenEvent` now carry
  `cacheCreationTokens` and `cacheReadTokens` through extraction, grouping, and
  aggregation. `ModelPricing` gains cache rates and `CostEstimate` reports the
  two new cost components. CLI output breaks the four kinds out rather than
  collapsing them, since they bill at four different rates — cache segments are
  omitted when zero, so a project that never caches keeps the old two-part line.
  
  The dashboard already counted cache tokens but never priced them; its
  `estimateCost` now matches. Because the dashboard keeps a second copy of the
  aggregation, a new parity test pins the two pricing tables and both cost
  formulas to each other so they cannot drift into quoting different dollar
  figures for the same runs.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - The isometric map is now a dashboard view instead of a link out to a raw page.
  
  **SourceVision → Isometric Map** renders the map inline and puts its generation options in the UI: Source (auto / SourceVision analysis / direct scan), Max nodes (1–500) and an externals toggle, with Generate, Open in new tab and Download HTML. Each request is fetched by the view rather than handed straight to the frame, so "no analysis yet" arrives as a readable card that points at `ndx analyze` or the direct-scan option instead of a JSON error page rendered inside the map. The map document itself runs in a scripts-only sandbox — it needs scripts for pan, zoom and zone selection, and nothing else.
  
  The view is hidden from navigation in an exported dashboard, where no server exists to build the map, and the Architecture page's old external link now points at the view.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix two isometric-map defects the new UI smoke test exposed.
  
  `ndx init` writes empty `.sourcevision/` data files before anything has been analyzed, so `hasSourcevision()` was true on a freshly-initialized project and auto mode never fell back to a scan. A project full of source that had not been analyzed yet reported "nothing to map". Auto now falls back when the analysis parses but contains no zones.
  
  `GET /api/iso-map` answered 404 for "this project has nothing to map yet". That is a state of the map, not a missing resource, and a 4xx on a `fetch` writes a network error into the browser console — which `tests/e2e-ui/navigation.spec.ts` requires every view to load without. It now answers 200 with an `x-iso-map-empty` marker header and a readable empty-state page, so the viewer still renders its own empty card and anyone opening the URL directly gets a page rather than a JSON blob. Genuine faults (bad parameter, wrong method, build failure) remain 4xx/5xx.
  
  Also adds the `iso-map` and pre-existing `pr-markdown` views to the navigation smoke test, whose list is meant to track every `ViewId`.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - Iso map: one implementation, several gaps closed.
  
  The standalone skill script is now generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` rather than hand-maintained, so the map has a single source of truth; `tests/e2e/iso-skill-drift.test.js` fails if the committed bundle goes stale, and also executes it. This removed a real divergence where the two copies disagreed on zone colours because one counted archetypes before mapping them to kinds and the other after — kinds are now resolved per file and counted once, which answers "what does this zone do" rather than "what is its most common file type".
  
  Also: the project scanner moved into the package (`iso-scan.ts`) and gained tsconfig `paths`, workspace-package and Go `go.mod` resolution, so a monorepo's own packages stop looking third-party; call-graph data, when present, adds per-edge runtime call counts with a Weight: imports/calls toggle and surfaces call-only edges as injected seams; output is reproducible (timestamps default to the HEAD commit time); key files link to source via the git remote; multi-layer edges route through corridors between rows instead of cutting through blocks; and the page gained a light theme, reduced-motion support, kind glyphs alongside colour, a skip link, and a tab order of one stop per zone instead of one per connector.
  
  New: `ndx iso`, `sourcevision iso --source=scan`, and `GET /api/iso-map` in the web dashboard.

- [#347](https://github.com/en-dash-consulting/n-dx/pull/347) [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Protect the loopback dashboard from cross-origin state changes by rejecting untrusted browser mutations and replacing wildcard CORS with a validated loopback origin.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Expose the task-routing config surface in `ndx config` and the dashboard.
  
  `ndx config` now validates `llm.tiers.<vendor>.<tier>`, `llm.routes.<class>`,
  `llm.effort.<class>`, and `llm.escalation.*`, and documents them in `--help`
  along with the fact that top-level `llm.model` is a standard-tier shorthand
  rather than a global override. The dashboard's LLM config route accepts the
  same keys, plus `llm.model` itself — writable via the CLI but previously absent
  from the route's allowlist, so the field with the highest precedence over the
  model actually used was invisible in the UI.
  
  Validation is deliberately asymmetric. Values are checked strictly, and so is
  the shape of a tier path: an unrecognized vendor or tier there is a typo, never
  a feature. Route and effort *class names* stay open, because glob keys
  (`prd.*`, `*`) are the documented routing design and this layer cannot see the
  task-class registry without importing across a tier boundary.
  
  Both surfaces also had to learn that task classes contain dots. Since config
  paths use dots as separators, `llm.routes.agent.execute` would otherwise write
  a nested `{agent: {execute}}` object — which the flat-map extractor in
  `loadLLMConfig` silently ignores, making the setting appear to work while
  changing nothing. Those two sections now treat everything after the section
  name as one literal key, on both the read and write paths.
- Updated dependencies [[`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec)]:
  - @n-dx/rex@0.5.2
  - @n-dx/llm-client@0.5.2
  - @n-dx/sourcevision@0.5.2

## 0.5.1

### Patch Changes

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Gemini support to the dashboard LLM Provider view, and complete the documentation cleanup
  
  The dashboard offered claude / codex / local only, so a project configured with
  `llm.vendor google` could not see or edit its model settings there and
  `llm.google.*` was absent from the config API response. Gemini is now a
  first-class vendor in that view.
  
  Also completes the outstanding documentation findings: removes the removed
  `prd.md` + `prd.json` dual-write architecture from the rex README (including an
  unreplaced `![img_here](img_here)` placeholder that shipped to npm), corrects
  the Node floor to match `engines: >=22`, completes the command references, and
  deletes or archives superseded docs.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - A run file that cannot be read is no longer treated as a run file that changed.
  
  Both change detectors trust mtime only once it is older than the filesystem's timestamp granularity, and inside that window compare a hash of the bytes instead. `hashFile` returns null when the read fails, and both docblocks promised the caller treats that as "no usable hash" rather than as a change. Neither caller did: the comparison guarded the *previous* hash against null but not the new one, so a previously-hashed file whose read now failed compared `"abc" !== null` and was reported modified.
  
  In the web aggregator that was the expensive direction to get wrong. "Modified" means subtract-then-re-read, and when the re-read failed too the contribution was dropped outright — so a momentarily unreadable run file silently lost its tokens from the per-task aggregate until something else touched it. Absence of evidence became a deletion. The hench detector only reports the change without mutating an accumulator, so the cost there was a spurious change flag.
  
  Both now require *both* hashes to be usable before a difference counts. mtime and size already agree at that point, so nothing suggests a rewrite — only that this scan could not check, which is not the same thing. Each side gained a test that injects the read failure (reproducing it from the filesystem is platform-specific; the branch is not) and asserts the file's tokens survive it, with a precondition check so it cannot pass vacuously when no hash was being carried.
  
  Fixed in both copies together, as the twins' shared rule requires. Note for anyone tracing this: there is no parity test between these two detectors and there was never meant to be — `incremental-task-usage.ts` explains why they are deliberately unshared and unpaired, unlike the `quoteWindowsToken` twins.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop re-hashing unchanged run files on every dashboard poll.
  
  The incremental task-usage aggregator trusts mtime only once it is older than the filesystem's timestamp granularity; inside that window it also carries a hash of the file's bytes, so an equal-length rewrite that reused the same mtime is still visible. The contract is that a file is hashed for the scan or two following its last write and never again, which requires re-snapshotting surviving files on every scan so the hash is dropped once the mtime ages out.
  
  That re-snapshot loop sat *after* the no-change short-circuit, so on quiet polls — the common case — it never ran. A file first observed inside the granularity window kept `mtimeMayBeShared` set for the life of the process and was re-read and re-hashed on every poll, which is exactly the steady-state cost the snapshot design exists to avoid. On a busy `.hench/runs/` directory that is a full read of every recently-written run file, every poll, forever.
  
  The loop now runs before the short-circuit. Its placement is bounded on both sides and the code says so: after categorisation, which needs the previous snapshots to compare against, and before the early return, because quiet scans are precisely the ones it has to run on. The short-circuit still guards the contribution work, so a quiet poll does no subtract/re-read — verified by a test, since re-snapshotting earlier must not turn a quiet poll into a re-aggregation.
  
  Results were never wrong, which is why this was invisible from the outside: the defect was in what the cache retained and re-read. The three new tests therefore assert the private snapshot state and the hash-call count, including a precondition check so they cannot pass vacuously if the first scan lands outside the window.
  
  hench's `RunChangeDetector` twin is unaffected — it has no short-circuit and rebuilds its checkpoint from every scan, so its hash drops on schedule.

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Update LLM model catalogs to current vendor releases
  
  Refreshes the Claude, Codex, and Gemini model catalogs and fixes several
  incorrect context-window and pricing entries. Two of the previous defaults
  pointed at models that are no longer usable.
  
  **Claude**
  - `claude-opus-4-8` → `claude-opus-5` in the init catalog, the `opus` shorthand
    alias, and the `heavy` tier (was `claude-opus-4-7`).
  - Added a `fable` shorthand alias for `claude-fable-5`.
  - Corrected context windows: `claude-sonnet-4-6` and `claude-opus-4-7` are 1M
    models, not 200K.
  - Corrected pricing: `claude-haiku-4-5` is $1.00/$5.00 (was $0.80/$4.00) and
    `claude-opus-4-7` is $5.00/$25.00 (was $15.00/$75.00).
  - Default remains `claude-sonnet-5`.
  
  **Codex** — GPT-5.6 replaces the GPT-5.4/5.5 line
  - Default is now `gpt-5.6-terra` (was `gpt-5.5`), with `gpt-5.6-sol` as a new
    `heavy` tier (codex previously had no tier above standard) and `gpt-5.6-luna`
    as `light` (was `gpt-5.4-mini`).
  - `gpt-5.4` and `gpt-5.4-mini` retire from ChatGPT-authenticated Codex sessions
    on 2026-08-31; `gpt-5.3-codex` and `gpt-5.2` are already unavailable there.
    All four are now legacy aliases that normalize to OpenAI's stated
    replacements, so existing `.n-dx.json` files keep working after upgrade.
  - `gpt-5.5` is still supported and remains a selectable catalog entry.
  - `openai-api-provider` default was `gpt-4o`; now `gpt-5.6-terra`.
  
  **Google**
  - `gemini-2.0-flash` has been **shut down** by Google and was the configured
    `light` tier — replaced with `gemini-3.5-flash-lite`. `standard` moves from
    `gemini-2.5-flash` to `gemini-3.7-flash`.
  - `heavy` intentionally stays on `gemini-2.5-pro`, the newest *stable* Pro
    model. `gemini-3.1-pro-preview` is newer but is a preview release whose ID
    may be renamed or withdrawn; it remains selectable via `llm.google.model`.
  - Corrected `gemini-2.5-flash` pricing to $0.30/$2.50 (was $0.15/$0.60).
  
  Also refreshes the dashboard's model suggestions, which still listed retired
  IDs (`claude-haiku-3-5`, `claude-3-7-sonnet-20250219`, `o3`, `o4-mini`), and
  updates model examples in `ndx config --help`, `ndx init --help`, and the
  configuration guide.

- [#331](https://github.com/en-dash-consulting/n-dx/pull/331) [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Add `--verbose`/`--debug` live progress across `ndx init` and `sourcevision analyze`, and replace scattered vendor string literals with shared `LLM_VENDOR` constants.
  
  **Live progress instrumentation.** `ndx init` gave no visibility into a slow `sourcevision analyze` run — `--debug` reached the child process but its output was fully captured and discarded on success, so a slow run was indistinguishable from a hung one. `ndx init`'s spinner now forwards the child's own progress live (throttled so a high-volume `--debug` firehose can't stall the pipe via backpressure), and the Components phase (component parsing, route detection, server-route detection) gets per-operation timestamped tracing plus automatic gap detection that flags any silence past 250ms by naming the last known checkpoint. A worker-thread-backed live stopwatch prints an incrementing "current operation runtime" for any operation still in flight — verified to keep ticking even during a fully synchronous, non-yielding block, which a same-thread timer cannot do. `hench`'s shell tool gets equivalent live-tail output for long-running commands.
  
  **Fixed a real infinite loop this instrumentation surfaced.** `inferPrefix` (server-route prefix inference) could spin forever on any two ordinary routes that share no deeper common path (e.g. `/users/:id` and `/orders`) — confirmed live via a CPU sample showing 100% of time in `String.prototype.lastIndexOf`. Also tightens `isLikelyRouteFile` so a client-side `api/` directory (axios/fetch-style callers, not Express-style route definitions) is no longer scanned for server routes at all, and adds a length guard against any future misextracted route "path" that's actually an unrelated string literal.
  
  **Vendor literal consolidation.** Replaces hardcoded `"claude"`/`"codex"`/`"google"`/`"local"` string comparisons throughout `core`, `hench`, `rex`, `sourcevision`, and `web` with the canonical `LLM_VENDOR`/`DEFAULT_LLM_VENDOR`/`LLM_VENDORS`/`isLLMVendor` helpers exported from `provider-interface.ts` and re-exported through each package's llm-client gateway, so the supported-vendor set has one source of truth instead of being duplicated ad hoc at each call site.
  
  **Fixed `ndx config <key>` incorrectly reporting an initialized project as stale.** The pre-dispatch directory resolver used for the staleness check and command-timeout config load treated a config key like `llm` as a target directory when no explicit directory argument was given, so `ndx config llm` looked for `.sourcevision`/`.rex`/`.hench` under a nonexistent `llm/` subdirectory and reported a fully-initialized project as uninitialized.
- Updated dependencies [[`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9)]:
  - @n-dx/rex@0.5.1
  - @n-dx/sourcevision@0.5.1
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Adaptive Optimization view (HENCH → Adaptive) consuming the previously UI-less /api/hench/adaptive routes: recent-run metrics with trends, recommended adjustments with apply/dismiss/lock actions, adaptive settings with locked keys and manual overrides, and the full adjustment history.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Overview's Re-analyze and Full analysis triggers now use the standard dashboard button styles (`cmd-btn-primary` / `cmd-btn-secondary`) instead of the low-emphasis inline-trigger look.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The LLM credential chip no longer spawns `ndx auth` on every settings-page visit: the server caches the check result for its lifetime, invalidates it when LLM config is saved, dedupes concurrent requests into one spawn, and the Re-check button forces a fresh run via `?refresh=true`.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - A failing CI check in the Validation view now renders the CI report it produced (with its pass/fail state) instead of a raw error banner — the banner is reserved for runs that yielded no report at all.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - GET /api/project now returns the resolved cliName, and the viewer gains a useCliName() shared-state hook — the single read path for the project CLI name in dashboard components. The default CLI name across all resolvers is now "n-dx".

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Close out Codex workflow parity ([#122](https://github.com/en-dash-consulting/n-dx/issues/122)) and fix the skill-tracking asymmetry ([#284](https://github.com/en-dash-consulting/n-dx/issues/284)).
  
  - **Body-drift regression test** — a new e2e test regenerates the assistant artifacts from the canonical source (`assistant-assets/`) and asserts the committed `CLAUDE.md`, `AGENTS.md`, and every vendor `SKILL.md` match the generator. This closes the last acceptance gap of [#122](https://github.com/en-dash-consulting/n-dx/issues/122) (tests now fail on body drift, not just inventory drift). It immediately caught a real drift: the committed `CLAUDE.md` carried a `## Changeset Versioning` section that was never in the canonical `project-guidance.md`, so `AGENTS.md` silently lacked it — that section is now in the shared source and both instruction files carry it.
  - **[#284](https://github.com/en-dash-consulting/n-dx/issues/284) — commit both:** the generated Claude `ndx-*` skills were gitignored while the Codex skills were committed, so cloned checkouts lacked the `/ndx-*` skills for Claude until re-init. `.claude/skills/` is removed from `.gitignore`, the generated skills are committed (and LF-pinned in `.gitattributes`, matching `.agents/skills/`), and `ndx init` now warns via `checkSkillTracking()` when an enabled assistant's skill directory is gitignored.
  - **Docs sweep:** the web package README and the troubleshooting guide no longer describe MCP setup as Claude-only.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Declare `color-scheme` on the theme roots so native form chrome (select dropdown popups, number-input spinners, scrollbars, autofill) renders in the active theme's scheme instead of always light — most visible on the input-heavy settings pages in dark mode.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Commands reference section: a server-driven manifest (GET /api/commands/manifest) lists every CLI command grouped by workflow stage with the project-resolved CLI name and computed availability (available / needs init / needs LLM), rendered in a dedicated All Commands view with its own sidebar section.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Commands reference rows gain inline Run buttons for dashboard-triggerable commands: the manifest now declares each command's trigger endpoint (and status endpoint for async runs), and rows show live running state plus a last-run outcome without a page reload. Commands without trigger support stay read-only with their resolved CLI invocation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command references now use the project's resolved CLI name instead of a hardcoded one. Sidebar and breadcrumb labels, page titles, FAQ answers, settings hints, and every panel's "equivalent to" snippet read from shared state, so a project whose binary is `myapp` sees `myapp work` throughout. Constant tables carry a `{cli}` placeholder resolved at render; a guard test fails the build if a bare command reference reappears in viewer source. Also removes a duplicate `document.title` writer in main.ts — Breadcrumb owns the title, and the second writer was racing it.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix an import-graph history bug and make the web test suite deterministic under parallel load.
  
  Dependency-preview **Back** could be permanently disabled: clicking a file before the focus-history seeding effect flushed (slow first paint) dropped the outgoing file, so history held a single entry. Seeding now happens synchronously with the click.
  
  Test-side: route tests bind and fetch `127.0.0.1` (never `localhost`), await server close so ephemeral ports are fully released, and reset process-wide route state via `resetHenchRouteStateForTests()`. The DOM-counting complexity test counts traversal steps instead of comparing elapsed-time ratios, and gesture-driven graph tests re-dispatch inside `waitFor` rather than firing once at a listener that may not be attached. Rules for both failure families are documented in TESTING.md.
  
  The web package typecheck now also covers `packages/web/tests`, so test-only type and syntax errors fail `pnpm typecheck` instead of surfacing later during Vitest transforms.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a dashboard "Refresh Data" trigger: new `ndx refresh --live-server` mode skips the pre-refresh server termination and refuses UI-rebuild plans, and the web dashboard gains POST /api/commands/refresh (+ status poll) with a Refresh Data panel in the Commands view.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Commands reference no longer marks LLM commands "needs LLM" on projects without an explicit `llm.vendor`: the manifest now mirrors the CLI's own default (absent vendor resolves to claude), so plan/recommend/add/work/self-heal/pair-programming show as available on any initialized project.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Commands-reference rows now match what their Run buttons actually do: the plan row is read-only (its trigger ran only the rex step, not the full plan pipeline), refresh's description states the trigger uses --data-only, ci gains a Run trigger with status polling, and analyze no longer declares a status endpoint its synchronous quick run never uses. rex fix/reshape remain deliberately Validation-view actions.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command triggers (refresh, ci, auth, self-heal, export) now resolve the ndx CLI on analyzed projects that aren't the n-dx monorepo: cli.js advertises its own path to child processes via `N_DX_CLI_PATH`, and the server's resolver tries the project-local bin, that env path, and `@n-dx/core/cli.js` from its module graph before the monorepo dogfood fallback.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Overview Next Steps panel now matches the page's section styling (its classes previously had no CSS), adds per-item copy and copy-all-as-markdown controls, and gains a confirm-guarded "Capture to PRD" action backed by a new `POST /api/rex/capture-next-steps` endpoint that dedups findings by normalized title and files them as features under a "SourceVision Next Steps" epic.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `usePanZoom` producing a non-finite viewBox when its element measures zero.
  
  Every gesture in the hook converts screen pixels into user-space units by dividing by the element's measured box, so a zero-sized box makes the scale `Infinity` — and `NaN` wherever the delta is also zero, since `0 * Infinity` is NaN. An ordinary vertical scroll has `deltaX: 0`, so the common case produced `NaN -Infinity 400 300`: that value goes straight into the rendered viewBox attribute, and because the bad value is *stored*, the surface stays broken after the element is sized again.
  
  Zero-sized is narrower than it sounds — a `display:none` element cannot receive the event at all — but it is reachable: a container mid-collapse (this codebase animates exactly that in the codebase-map transition), a drag that begins while the element is sized and continues after it collapses, or a first interaction landing before layout settles.
  
  Each handler now returns early when the box is unusable, rather than clamping the scale to something finite. Clamping would keep the gesture alive by inventing a magnitude — panning by a distance derived from an element size that does not exist. Doing nothing leaves the viewBox exactly as it was, and the next event once layout settles behaves normally. The wheel guard sits after `preventDefault` so a zero-sized surface still swallows the wheel instead of suddenly scrolling the page mid-animation.
  
  The guard also covers the ctrl+wheel zoom branch, which divides by the same box for its cursor focal point. The hook previously had no test coverage at all; it now has nine, half of them pinning the normal-path arithmetic at two different element-to-viewBox ratios so the divisions are asserted rather than only the guard.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Pass-gated SourceVision views (Architecture P2, Problems P3, Suggestions P4) are now navigable before their data exists: the sidebar no longer disables locked tabs, and each locked view shows an unlock page with two actions — run enrichment up to just the pass that view needs, or run the full analysis (all passes). Backed by a new `sourcevision analyze --target-pass=<N>` flag and a `targetPass` option on `POST /api/commands/sv-analyze` (async with status polling, like full runs).

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - New Requirements view (REX → Requirements) consuming the previously UI-less requirements API: coverage stats with category/validation/priority breakdowns and an expandable requirement → item traceability matrix with per-item status — the human surface for rex verify / verify_criteria.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard Reshape preview always reporting "no proposals": the server now spawns `rex reshape --format=json --quiet` so stdout is pure JSON (info() progress prose no longer breaks the report parse), and `rex reshape --format=json` emits a JSON report (`proposals: []`) instead of prose when no proposals are found.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Restore the orphaned Zones and Analyze & Import views into dashboard navigation: zone drill-down returns as a SourceVision tab, and the rex analysis/proposal-review workspace (smart add, batch import, project scan) gets a REX sidebar entry.

- [#324](https://github.com/en-dash-consulting/n-dx/pull/324) [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1) Thanks [@en-drza](https://github.com/en-drza)! - Add sample app installation feature with dashboard tutorial and optimize CLI resolution path

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal can be stopped from the dashboard. The web server exposes `POST /api/commands/self-heal/stop`, which kills the managed loop process (SIGTERM) and reports it as stopped rather than failed. The Self-Heal panel shows the current iteration and phase parsed from loop output, with a Stop button while it runs.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Text boxes on the General and "n-dx analyze / plan" settings pages now match the Analyze & Import input box (surface background, radius, padding, accent focus ring). Also repairs two invalid declarations left by the token remap (`var(--bg))` backgrounds and a mangled active-vendor-card background) that made inputs render transparent.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The General and "n-dx analyze / plan" settings pages now use the shared dashboard styling: their stylesheets were written against an undefined token vocabulary (--color-*/--spacing-*), leaving most declarations inert — all 163 usages are remapped to the real theme tokens, and the Save/Discard buttons now use the standard cmd-btn variants.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard jobs that write `.sourcevision/` — analysis (quick, targeted, and full), refresh, and CI — now share one write lock: starting any of them while another runs returns 409 naming the in-flight job, instead of letting two writers corrupt the analysis output. The previously unguarded quick-analysis path is covered too.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Standardized the Rex Analysis and Hench Optimization pages to the shared dashboard UI systems: the previously fully-unstyled Hench Optimization page now uses cmd-btn buttons, stat-grid/stat-card stats, a data-table preview, filter-select, and view-header conventions with a new per-view stylesheet; the Rex Analysis page header and its Smart Add / Batch Import / Project Scan action buttons now use the standard cmd-btn variants (identity classes preserved).

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard job progress now streams while commands run: full/targeted sourcevision analysis, data refresh, and self-heal spawn through `spawnManaged` with a new `onStdout` chunk callback, so status endpoints expose live output, refresh phases, and self-heal iteration progress mid-run instead of only after exit. The `signal` option briefly added to the buffering `exec` is removed — `spawnManaged.kill()` covers cancellation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface the remaining sourcevision capabilities in the dashboard: a Next Steps recommendations panel on Overview (GET /api/sv/next-steps), an Archetype column with override control in the Files tab (GET /api/sv/classifications, POST /api/sv/archetype), and public exports of deriveNextSteps/setArchetypeOverride consumed through the web sourcevision gateway.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The SourceVision Overview gains a "Full analysis" trigger that runs all four enrichment passes as a background job (202 + status polling with progress), unlocking the Architecture, Problems, and Suggestions tabs from the dashboard; quick re-analyze is unchanged.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Close the remaining small coverage gaps: a new Activity view (REX → Activity) renders the PRD execution log with event filtering and search, Settings → General gains a credential status chip backed by `ndx auth`, the Runs view gains a token-reporting validation trigger, and the Export panel gains a PDF report control. A facet distribution view was scoped and deliberately skipped — facets are MCP-only and unconfigured in practice; the rationale is recorded in docs/cli-ui-gap.md.

- [#318](https://github.com/en-dash-consulting/n-dx/pull/318) [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(token-usage): report actual token usage broken out by type (input/output/cache-write/cache-read), consistently in rollup and dashboard ([#294](https://github.com/en-dash-consulting/n-dx/issues/294))
  
  The per-item rollup summed cache tokens into a single conflated total (~23M for a run whose real work was ~40K), while the dashboard Usage page counted only input+output — a ~575× divergence for the same runs. Rather than pick one number, both surfaces now report the actual usage broken out by type, with no cost/pricing math.
  
  - **rex:** `ItemTokenTuple` now carries `input`, `output`, `cacheCreation`, `cacheRead`, and `total` (= their sum). `tokensFromRecord`, self/descendant attribution, and the ancestor roll-up track all four components; `get_token_usage` surfaces the breakdown.
  - **web:** the Usage-page extractor reads `cacheCreationInput`/`cacheReadInput` from run records (previously dropped), surfacing cache-write and cache-read as distinct fields and attributing run-level cache totals without double-counting across turns. `incremental-task-usage` uses the same breakdown, so the dashboard and rollup report identical numbers for the same runs.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Typecheck test files: `tsconfig.test.json` adds `tests/` to the program and `pnpm typecheck` now runs it, so test-only type errors (and syntax errors) fail the same gate as source instead of surfacing only at vitest transform time.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the dashboard's token-usage aggregation from missing a same-length run-file rewrite.
  
  `IncrementalTaskUsageAggregator` decided whether a run file had changed by comparing mtime + size. On Windows that misses a whole class of edit: file timestamps advance in ticks rather than continuously, so a rewrite of the same LENGTH inside one tick leaves both values identical. Measured on NTFS — 163 of 200 back-to-back same-size rewrites produced a byte-identical `mtimeMs`, with gaps between consecutive distinct mtimes running up to 10ms. An equal-length edit to a run record (a taskId or status swap) therefore kept its old contribution, leaving tokens attributed to the wrong task until some later change to that file forced a re-read. ext4 records nanoseconds, which is why Linux never showed it.
  
  mtime is now trusted only once it is older than a granularity bound. Inside that window the snapshot also carries a hash of the file's bytes and detection compares that instead; the hash is dropped as soon as the mtime ages out, so the steady state stays stat-only — a file is hashed for the scan or two after its last write and never again. Hashing unconditionally would have closed the same hole while defeating the point of an incremental aggregator.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - The Validation view gains repair, verification, and restructuring actions: Fix issues (`rex fix`, dry-run preview then apply, followed by automatic re-validation), Run CI check (`ndx ci`, async with structured JSON results), and Reshape PRD (`rex reshape`, previews proposals and applies only on explicit confirm). Backed by new /api/commands/{fix,ci,reshape} endpoints.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#321](https://github.com/en-dash-consulting/n-dx/pull/321) [`231c72f`](https://github.com/en-dash-consulting/n-dx/commit/231c72f38b17d329a2eabdba9940fb0e9799b949) Thanks [@endash-shal](https://github.com/endash-shal)! - WCAG AA accessibility: fix color contrast ratios, add prefers-reduced-motion support, and add non-color status indicators.
  
  **Color contrast fixes (tokens.css):**
  - Light mode: `--text-muted` #8b90a8→#6b6e88 (2.9:1→4.6:1), `--accent` #008f60→#006E4E (3.7:1→5.6:1), `--green` brand-green→#006E4A (2.2:1→5.6:1), `--orange` brand-orange→#B03800 (2.7:1→5.4:1), `--red` brand-rose→#B01A54 (fail→5.9:1)
  - Dark mode: `--text-muted` #6b7094→#868aaa (3.7:1→5.3:1), `--red` brand-rose→#f55574 (3.4:1→4.9:1)
  
  **Prefers-reduced-motion support** added to badges.css, graph.css, hench-runs.css, prd-tree.css, zone-slideout.css, neolithic-overlay.css, components.css.
  
  **Non-color indicators:** Hench run status in list cards and detail title now shows icon + text label via `.status-badge`. Zone health in overview now shows dot + "Good"/"Fair"/"Poor" text label.
  
  Palette reference added at `src/viewer/styles/PALETTE.md`.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard "Refresh Recommendations" action so it reliably surfaces its result. `rex recommend --format=json` emits a JSON array, but the `/api/commands/recommend` handler spread it into an object (`{ ok: true, ...parsed }`), turning the recommendations into numeric-keyed props and dropping the count. The client then discarded the response entirely and only showed a bare "Done". The handler now returns `{ ok: true, recommendations: [...], count: N }` (with the non-JSON fallback preserved), and the Suggestions view reports the real count ("N recommendations found" / "No new recommendations") instead of a no-op confirmation.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Zones graph: sort cross-zone-connecting files above internal-only files in expanded zone boxes (and nested sub-zone rows), so bridging files are not hidden by the 15-row cap, and add a per-zone "connecting only" toggle that filters the file list to cross-zone files.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Add unit tests for `buildFileConnectionMap` — the per-file cross-zone connection map behind the Zones graph file rows. Covers bidirectional call-edge connections with weight accumulation, exclusion of same-zone/unresolved/unzoned edges, external-import mapping (`@n-dx/`-scoped and bare package names, src/-preferring zone resolution, same-zone skip), and combined call+import weights. `buildFileConnectionMap` is now exported from `viewer/views/zones.ts` for testability, matching its sibling helpers.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Zones graph: hovering a cross-zone connecting file row now shows a tooltip listing each target zone name and its call weight (sorted by weight descending), resolved from the rendered zone list. Files with no cross-zone links show no tooltip.
- Updated dependencies [[`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d)]:
  - @n-dx/llm-client@0.5.0
  - @n-dx/rex@0.5.0
  - @n-dx/sourcevision@0.5.0

## 0.4.6

### Patch Changes

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix the import-graph zone map not filling its block when many boundaries are listed. The codebase-map cell used `align-items: start`, so it stayed at the SVG's natural height while the "Busiest boundaries" strip grew with its (uncapped) list, leaving a gap beneath the map. The grid now stretches the map cell to the row height and the SVG flexes to fill it, and the boundary list is capped (`max-height` + scroll) so a project with many cross-zone boundaries no longer stretches the whole block tall.

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99)]:
  - @n-dx/sourcevision@0.4.6
  - @n-dx/llm-client@0.4.6
  - @n-dx/rex@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- [#240](https://github.com/en-dash-consulting/n-dx/pull/240) [`7dc2319`](https://github.com/en-dash-consulting/n-dx/commit/7dc231981c78861a0ab5b3e4cefee1e940d474ea) Thanks [@endash-shal](https://github.com/endash-shal)! - pipeline testing fix

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/sourcevision@0.4.5
  - @n-dx/llm-client@0.4.5
  - @n-dx/rex@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.4.4
  - @n-dx/sourcevision@0.4.4
  - @n-dx/llm-client@0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.
- Updated dependencies [[`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0)]:
  - @n-dx/llm-client@0.4.3
  - @n-dx/rex@0.4.3
  - @n-dx/sourcevision@0.4.3

## 0.4.2

### Patch Changes

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix dashboard proposal acceptance silently dropping items. The
  `/api/rex/proposals/accept` and `/api/rex/proposals/accept-edited`
  handlers wrote new items via `savePRD` — which targets the legacy
  `prd.md` + ephemeral cache — instead of the folder tree
  (`.rex/prd_tree/`), the authoritative PRD surface per CLAUDE.md. The
  folder-tree watcher then rebuilt the cache from the unchanged tree, so
  accepted epics/features/tasks vanished with no error. Both handlers
  now write through `resolveStore().addItem()` and refresh the cache
  from the store so the dashboard sees the new items immediately.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign the Hench Runs view so the run history is the focus. The four
  operational diagnostic panels (concurrency, memory, WebSocket health, throttle)
  that previously stacked above the run list now live in a collapsed "System
  status" drawer at the bottom, and the WebSocket health panel — previously
  rendered with no CSS — is now styled to match the other panels.

- [#206](https://github.com/en-dash-consulting/n-dx/pull/206) [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e) Thanks [@endash-shal](https://github.com/endash-shal)! - Rework the PRD context graph, harden the hench run loop, and add LLM auto-failover.

  **PRD context graph (web)** — Top-down progressive-disclosure layout with folder-tree
  visual style; shape-based nodes for epic/feature/task/subtask; click-through opens the
  Rex task detail panel with subtree highlighting. Hierarchy is now driven from
  `.rex/prd_tree/` paths.

  **Hench run loop** — Per-task attempt tracking, completed tasks excluded from
  selection, and the loop advances immediately on success. The `no-plan-mode` rule is
  embedded in the agent system prompt; autonomous runs (`--auto` / `--loop` /
  `--epic-by-epic`) default to `acceptEdits`. New
  `docs/contributing/run-loop-invariants.md`.

  **LLM auto-failover** — New `llm.autoFailover` flag with vendor-specific failover
  chains; `hench run` restores the original config after a failover attempt. Model
  resolution honours top-level `llm.model` → `llm.{vendor}.model` → tier default.

  **Rex storage** — PRD tree rewritten to canonical `index.md`-per-folder layout with
  single-child compaction and atomic leaf-to-folder promotion for subtasks. Timestamped
  snapshots before structural migrations; cross-PRD duplicate detection in `reshape`.

  **CLI / DX** — New `ndx tree` command and tree-formatted `rex status`; `ndx self-heal`
  gains a pre-execution approval gate with `selfHeal.autoConfirm`. Obfuscated-code commit
  blocker added.

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - PRD tree row decluttered. The Token Usage cell is now gated on the
  `showTokenBudget` feature flag (no more noisy column on every row when
  budgets aren't active). Duration and timestamp are removed from the
  row — both still live in the task detail flyout. The level badge
  (`EPIC` / `FEATURE` / `TASK` / `SUBTASK`) now renders only on the
  first item of each contiguous same-level group, so it reads as a
  section header for that indentation instead of repeating on every
  row. Status remains an icon-only indicator with the full label on
  hover.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix two Tasks-view bugs: Quick Add now persists `acceptanceCriteria` on
  accepted task proposals (it was dropped client-side in both the direct-accept
  and proposal-editor paths), and the dashboard "Start Task" button now launches
  an autonomous hench run for the task via `/api/hench/execute` instead of merely
  flipping its status to in_progress.

- [#216](https://github.com/en-dash-consulting/n-dx/pull/216) [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a) Thanks [@dnaniel](https://github.com/dnaniel)! - Smart-add fixes — nesting, dashboard Quick Add, and clearer errors.

  **Nesting (rex):** `n-dx add` no longer creates a duplicate epic when the work
  belongs under an existing one. The LLM was supposed to set `existingId` for
  placement under an existing epic/feature but often omitted it. Added a
  deterministic post-generation pass that matches proposed epics/features
  against existing PRD containers (high-confidence, title-based) and fills
  `existingId` so the new task nests instead of duplicating. Respects an
  `existingId` the LLM already set; skipped when an explicit `--parent` is
  given.

  **Dashboard Quick Add latency (rex + web):** new `--fast` flag for `rex add`
  forces the vendor's light tier (haiku for Claude, gpt-5.4-mini for Codex) so
  the CLI provider completes well within the timeout from a daemonized server.
  The web Quick Add preview now passes `--fast`; the user-driven CLI
  `n-dx add` is unchanged.

  **Timeout error message (web):** the smart-add timeout no longer wrongly
  implies "set an API key" is the fix — the Claude CLI provider is a valid
  first-class path. The message now points at the right diagnostic
  (`time claude -p`), notes an API key is only an optional speed-up, and
  appends captured stderr when present.

- [#211](https://github.com/en-dash-consulting/n-dx/pull/211) [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc) Thanks [@dnaniel](https://github.com/dnaniel)! - SourceVision zone-pin determinism, analyze stability, and Map UX.

  **SourceVision** — Stop spurious enrichment-pass resets on a no-op `analyze`
  (partition-independent input fingerprint reused when code/config is unchanged).
  Zone pins whose target zone did not form are no longer silently dropped — a
  grouped warning finding is emitted (issue [#210](https://github.com/en-dash-consulting/n-dx/issues/210), part 1). New
  `sourcevision.zones.anchors` config declares a named zone from a file glob that
  is forced to exist, making single-target pin consolidations deterministic
  across runs (issue [#210](https://github.com/en-dash-consulting/n-dx/issues/210), part 2). `.rex/` and `.hench/` are excluded from the
  file inventory so generated PRD markdown / run logs no longer skew Overview
  language stats.

  **Web** — Codebase/Zone Map overhaul: deterministic grouped grid layout (no
  overlap), flexbox-centered node labels, cursor-anchored bounded zoom/pan
  (wheel + touch pinch), near-fullscreen File Street View modal, Escape as a
  hierarchical back, and a non-hijacking hover hint. Quick Add now resolves the
  rex CLI from the server's own install (fixes `Cannot find module` for non-n-dx
  projects) with a longer smart-add timeout and an actionable no-API-key error.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Rework the Rex Tasks view status filter and initial state. The status filter is
  now a multi-select dropdown showing per-status counts with "View all" and
  "Pending only" quick actions. On a fresh load the tree defaults to showing only
  pending items when any exist (otherwise all statuses), and the tree now starts
  fully collapsed.

- [#218](https://github.com/en-dash-consulting/n-dx/pull/218) [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign the Rex Tasks view controls and fix scrolling. Replaces the stacked
  filter UI with a two-row control bar (search + match count + inline actions on
  top, icon-only status pills + tag typeahead below) and collapses the nested
  scroll regions into a single bounded scroller so the task list is the only thing
  that scrolls.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Redesign finding cards. The previous "left-bar + severity-tinted background"
  treatment had two problems: a stray `.severity-warning` rule in tables.css
  was washing entire warning cards in dark orange (orange text on orange
  background — unreadable), and the left-bar-per-card pattern has become an
  AI-dashboard tell. New design:

  - Cards are a single neutral surface — no severity tint, no left bar.
  - Severity reads from a small colored icon + small-caps label on the meta
    row. Color sits on the symbol, not on the entire card.
  - Severity, type, and scope live on one quiet meta line separated by `·`
    instead of three competing badges with their own backgrounds.
  - Body text gets the visual weight: high-contrast, 14 px, generous leading.

  The `tables.css` bare `.severity-*` rules are not touched (they still apply
  to real table cells); `.finding-card.severity-*` overrides them via higher
  specificity so finding-card chrome isn't affected.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Three Graph-view polish fixes:

  - Zone map sizing: the per-zone "Zone Map" SVG was rendering at the full
    container width × (640/980) ratio, which on a wide screen exploded to
    > 1100px tall and ate the whole viewport. Now pinned to its viewBox aspect
    > ratio with a `max-height: min(60vh, 680px)` cap so the map stays the focus,
    > not the page.
  - Outside-click closes File Street View. Previously only Escape or the Close
    button worked; clicking outside the dialog shell now closes it too,
    mirroring conventional modal behavior.
  - Cross-zone edge labels in File Street View are deduplicated. Multiple
    edges between the same source→target zone pair used to stack identical
    "UI Overlays → App-Core Bridge" labels. Now one label per pair, with a
    `×N` count when bundled, positioned at the centroid of the edge bundle.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Zone-view layout polish:

  - On viewports ≥ 1280px, the Current Selection side panel docks to the right
    of the Zone Map instead of stacking underneath, so the map and the
    selection details share the screen instead of forcing a scroll.
  - The Zone Map header "files" stat now shows the selected zone's share of
    the project (e.g. `5 / 102 files`) so the count is anchored to the whole
    codebase instead of reading as an unmoored number.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Three Graph-view polish moves:

  - File Street View hover spotlight. Hovering an edge highlights it and its
    two endpoints; hovering a node highlights every edge touching it and the
    connected nodes; everything else mutes. Cross-zone edge labels show on
    hover even for non-representative edges. A wide invisible hit area on
    each edge makes thin lines forgiving to point at.
  - Remove the redundant per-zone "Map of Zone" header (kicker + zone name +
    zone-only stats) from the in-panel Zone Map. Those stats now live in the
    scope-card up in the codebase-map section as "Zone Name · X/Y files · N
    internal · K in / M out", so they're visible without occupying header
    real estate twice.
  - Wide-screen layout now applies to any `.ig-graph-shell` (not just the
    zone-active variant) so the Current Selection panel docks to the right at
    ≥ 1280px regardless of which view you're in.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - When a zone is active in the Graph view, the masthead metric tiles now show
  _zone-scoped_ numbers (zone files / project files, internal imports, external
  packages used, neighbor zones) instead of repeating the project totals. The
  previous behavior was misleading — "102 files / 115 imports" stayed in the
  hero even when you'd zoomed into a 5-file zone.

  Side-by-side breakpoint lowered to 1100px and reinforced with `!important`
  so the Current Selection panel actually docks to the right on wide screens
  rather than getting silently overridden by the base column layout.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Show the focused file path inline next to the "FILE STREET VIEW" kicker so
  the user always knows which file the dependency graph is centered on without
  hunting for the highlighted node.
- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc)]:
  - @n-dx/llm-client@0.4.2
  - @n-dx/rex@0.4.2
  - @n-dx/sourcevision@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1
  - @n-dx/rex@0.4.1
  - @n-dx/sourcevision@0.4.1

## 0.4.0

### Minor Changes

- [#198](https://github.com/en-dash-consulting/n-dx/pull/198) [`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262) Thanks [@endash-shal](https://github.com/endash-shal)! - Address security findings, fix package publishing regression, and refresh documentation.

  **Security** — clears 27 of 30 Dependabot advisories:

  - `@modelcontextprotocol/sdk` ^1.25.3 → ^1.29.0 (rex, sourcevision, web) — fixes cross-client data leak via shared transport reuse (GHSA-345p-7cg4-v4c7) plus transitive `hono`, `@hono/node-server`, `path-to-regexp`, `ajv`, and `qs` advisories.
  - `@anthropic-ai/sdk` ^0.85.0 → ^0.94.0 (hench, llm-client) — fixes insecure default file permissions in the local-filesystem memory tool (GHSA-p7fg-763f-g4gf).
  - `vitest` ^4.0.18 → ^4.1.5 (root) — fixes transitive `vite` and `picomatch` advisories.
  - Adds range-scoped `pnpm.overrides` for `picomatch`, `postcss`, `hono`, `@hono/node-server`, `ajv`, `path-to-regexp`, `qs`, and `vite` to pin patched versions in transitive trees the resolver would otherwise leave on older cached versions.

  Audit drops from 11 high / 21 moderate / 2 low to 1 high / 2 moderate. The remaining advisories (rollup, esbuild, vite reached via `vitepress`) are dev-server-only docs-build vulns deferred to a follow-up.

  **Packaging regression guard** — moves `assistant-assets/` under `packages/core/` so it ships inside the published `@n-dx/core` tarball, and adds two e2e tests to prevent recurrence:

  - `tests/e2e/published-assets-bundled.test.js` — asserts `pnpm pack` includes the assistant-assets payload.
  - `tests/e2e/published-package-loadability.test.js` — installs each packed tarball into a clean fixture and verifies CLIs load.

  **Docs** — README, getting-started, and quickstart updates with screenshots in `documentation/` to walk through `ndx init`, `analyze`, `plan`, `work`, `status`, `start`, `ci`, and `self-heal`.

### Patch Changes

- Updated dependencies [[`4de9d46`](https://github.com/en-dash-consulting/n-dx/commit/4de9d46036963129b0e962e1c9aed7e0b9d87262)]:
  - @n-dx/sourcevision@0.4.0
  - @n-dx/llm-client@0.4.0
  - @n-dx/rex@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/sourcevision@0.3.4
  - @n-dx/llm-client@0.3.4
  - @n-dx/rex@0.3.4

## 0.3.3

### Patch Changes

- [#193](https://github.com/en-dash-consulting/n-dx/pull/193) [`700f356`](https://github.com/en-dash-consulting/n-dx/commit/700f356b146864e2aacafd9f0cace42a7942add8) Thanks [@en-drza](https://github.com/en-drza)! - Fix broken external links in the landing page. GitHub links pointed to the old `endash/n-dx` org handle (now `en-dash-consulting/n-dx`) and the npm link pointed to the old unscoped `n-dx` package (now `@n-dx/core`). Updated all six occurrences including the inline security manifest comment.

- Updated dependencies []:
  - @n-dx/rex@0.3.3
  - @n-dx/sourcevision@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- [#189](https://github.com/en-dash-consulting/n-dx/pull/189) [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363) Thanks [@dnaniel](https://github.com/dnaniel)! - Refresh the SourceVision Map experience with cohesive zone/import exploration, remove obsolete Zones navigation, gate PR Markdown behind a feature flag, and dedupe promoted sub-analysis zones.

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd), [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363), [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48)]:
  - @n-dx/rex@0.3.2
  - @n-dx/sourcevision@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/sourcevision@0.3.1
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/sourcevision@0.3.0
  - @n-dx/llm-client@0.3.0
  - @n-dx/rex@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/sourcevision@0.2.3
  - @n-dx/llm-client@0.2.3
  - @n-dx/rex@0.2.3

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/sourcevision@0.2.2
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/rex@0.2.1
  - @n-dx/sourcevision@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/sourcevision@0.2.0
  - @n-dx/llm-client@0.2.0

## 0.1.9

### Patch Changes

- [#106](https://github.com/en-dash-consulting/n-dx/pull/106) [`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82) Thanks [@ryrykeith](https://github.com/ryrykeith)! - ### SourceVision

  - Go language support: import graph analysis, zone detection, route extraction, archetype classification
  - Multi-language project detection (Go + TypeScript coexistence)
  - Database package detection and Architecture view panel (194 known packages across Go/Node/Python)
  - Handler → Database flow tracing in Architecture view
  - Architecture view layout improvements for long Go module paths

  ### Rex

  - Go module scanner (`go.mod` dependency parsing)
  - Go-aware analysis pipeline integration

  ### Hench

  - Go test runner support
  - Go-specific agent planning prompts
  - Go guard defaults in schema

  ### Web Dashboard

  - Database Layer panel in Architecture view
  - Handler → DB Flows panel with BFS path tracing
  - Bar chart label improvements (wider labels, SVG tooltips, smart truncation)
  - Table cell overflow handling for long package names

  ### LLM Client

  - Schema updates supporting Go language constructs

- [#98](https://github.com/en-dash-consulting/n-dx/pull/98) [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Add `withTransaction` API for safe concurrent PRD writes with file locking
  - Add `level` field to `edit_item` MCP tool for changing item hierarchy levels
  - Fix LLM reshape response parsing with action normalization and lenient fallback
  - Fix `--mode=fast` being ignored when `--accept` is passed to `reorganize`
  - Extract shared archive module for prune/reshape/reorganize
  - Add reorganize archiving (removed items preserved in `.rex/archive.json`)
  - Proactive structure: MCP schema coverage audit test

  ### Hench

  - Show auto-selection reasoning in run header (why task was chosen, skipped counts, unblock potential)
  - Show prior attempt history in task card (retry count, last status)
  - Classify changes in run summary (code/test/docs/config/metadata-only)

  ### Web Dashboard

  - Default to showing all PRD items (fixes blank page for 100% complete projects)
  - Remove redundant StatusFilter, wire status chips to tree visibility
  - Smart collapse: tree starts closed when no active work
  - Hide view-header, promote breadcrumb as page title
  - Show sibling page icons in collapsed sidebar rail
  - Move command buttons (Add, Prune) inline into search row
  - Add filtered-empty state messaging

  ### CLI

  - Surface all package commands through `ndx` (validate, fix, health, report, verify, update, remove, move, reshape, reorganize, prune, next, reset, show)
  - Helpful error when running orchestrator commands on package CLIs
  - Workflow-based `ndx --help` grouping (no package names in primary help)
  - Skip provider prompt on re-init when config exists
  - Unified init status report
  - Branded ASCII art CLI header

  ### Docs

  - New 5-minute quickstart tutorial
  - New troubleshooting guide (7 common issues)
  - Commands reference rewritten by workflow stage

  ### Infrastructure

  - `@n-dx/core` included in release workflow (synced version + auto-publish)
  - `/ndx-reshape` skill for PRD hierarchy restructuring
  - `/ndx-capture` skill updated with automatic parent placement and dependency wiring

- [#109](https://github.com/en-dash-consulting/n-dx/pull/109) [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb) Thanks [@dnaniel](https://github.com/dnaniel)! - ### SourceVision

  - **Zone stability:** Louvain community detection now seeds from previous zone assignments, preserving topology across runs. Files stay in their previous zones unless import structure genuinely shifts.
  - **Zone identity preservation:** Zones with >50% file overlap with a previous zone inherit its ID and name, preventing the LLM from inventing new names each run.
  - **Stability bias:** Synthetic co-zone edges reinforce previous zone membership during Louvain optimization. Configurable weight (default 0.5x median import edge).
  - **Stability reporting:** New `stability` field in zones.json tracks file retention, persisted/new/removed zones, and reassigned files between runs.
  - **Finding category taxonomy:** Findings now carry a `category` field (`structural`, `code`, `documentation`) enabling downstream filtering. LLM prompts request categories; regex heuristic classifies when LLM doesn't provide one.
  - **Finding staleness validation:** Findings referencing deleted/moved files are automatically skipped during `rex recommend`.
  - **Weighted cohesion metrics:** Project-wide averages weighted by zone file count. Zones with <5 files excluded from aggregates (unreliable metrics). Both weighted and unweighted averages reported.
  - **Small-zone merge logging:** Configurable merge threshold with debuggability logging.
  - **Git SHA refresh:** `manifest.gitSha` now updated at analysis start, not just init time.

  ### Rex

  - **Self-heal: exclude structural findings:** `--exclude-structural` flag on `rex recommend` skips zone boundary opinions. Self-heal loop passes it by default.
  - **Self-heal: file-level regression guard:** Progress signals shifted from zone-relative (weighted cohesion) to zone-independent metrics (circular deps, code findings, unused exports).
  - **Zone pin discoverability:** `ndx analyze` suggests zone pins when structural findings detected. `ndx config --help` documents `sourcevision.zones.pins`. `rex recommend` shows pin tip for structural findings.
  - **Workflow split:** Base n-dx workflow in `n-dx_workflow.md` (always updated on init) + user customizations in `workflow.md` (preserved across re-init). Prohibited changes section prevents lint-suppress-only commits.
  - **Stats fix:** Childless features now counted in `get_prd_status` totals.
  - **Config routing:** `sourcevision.*` config keys now route to `.n-dx.json` for zone pin management.

  ### Web Dashboard

  - Zone slideout shows "pinned" badge on files with zone pin overrides.
  - Server augments `/api/sv/zones` response with zone pins from `.n-dx.json`.

  ### CLI

  - Fix release workflow: use bash wrapper script for changeset version command (changesets/action splits on whitespace without a shell).

- [#99](https://github.com/en-dash-consulting/n-dx/pull/99) [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8) Thanks [@dnaniel](https://github.com/dnaniel)! - ### Rex

  - Proactive PRD structure health checks with configurable thresholds
  - Post-write health warnings on `rex add` and `rex analyze`
  - Structure health gate in `ndx ci` (fails below score 50)

  ### Web Dashboard

  - Checkbox multi-select: hover reveals checkbox, click row opens detail panel
  - Remove Edit icon from tree rows (detail panel handles editing)
  - Completion timeline view with date range filters (today/week/month/all)

  ### CLI

  - Fix release workflow: use `npx` for changeset commands (pnpm script resolution bug)

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`9c2963f`](https://github.com/en-dash-consulting/n-dx/commit/9c2963fcb95e9e80c4702878c958f486bf5f9fbb), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/rex@0.1.9
  - @n-dx/llm-client@0.1.9
  - @n-dx/sourcevision@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [[`e83e960`](https://github.com/en-dash-consulting/n-dx/commit/e83e9601f179855b69d49a3557ce1b29bdc082f9)]:
  - @n-dx/rex@0.1.8
  - @n-dx/sourcevision@0.1.8
  - @n-dx/llm-client@0.1.8
