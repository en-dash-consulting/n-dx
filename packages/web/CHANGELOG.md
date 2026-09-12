# @n-dx/web

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
