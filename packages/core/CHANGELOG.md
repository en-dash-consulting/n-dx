# @n-dx/core

## 0.6.0

### Minor Changes

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `.codex/config.toml` now uses cwd-relative stdio commands (`{"command":"n-dx","args":["rex","mcp","."]}`) instead of embedding this checkout's absolute `dist/cli/index.js` paths and project directory — matching the `.mcp.json` fix for Claude Code. Codex launches stdio servers with cwd at the project root, so both servers now start correctly from any worktree or teammate clone, and the registration survives the install moving or a dev-link toggle. The command name respects a configured `cli.name` in `.n-dx.json`.

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx init` no longer registers Claude MCP servers via `claude mcp add --scope local` by default — it relies solely on the tracked, cwd-relative `.mcp.json` written alongside it. Pass `--mcp-scope=local` to restore the local-scope registration for setups that cannot rely on `.mcp.json` being picked up.
  
  Init also no longer calls `claude mcp remove --scope user` — user scope is global, and stripping it removed registrations that had nothing to do with the project being initialised. Stale local-scope entries from a prior run are still cleaned up, but only when the existing entry's own recorded arguments actually target the project being initialised.
  
  The init recap now reports where MCP registration landed — tracked `.mcp.json`, local scope, or skipped (no `claude` CLI found).

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx init` now writes a tracked `.mcp.json` at the project root with cwd-relative stdio commands for rex and sourcevision (e.g. `{"command":"n-dx","args":["rex","mcp","."]}`), alongside the existing local-scope `claude mcp add` registration.
  
  Local scope is stored in `~/.claude.json` keyed by absolute project path, so worktrees and teammate clones got no MCP registration at all, and it broke whenever the install moved or a dev link toggled. `.mcp.json` is committed to the repo instead: every worktree and clone gets the same two entries, resolved relative to whatever directory Claude Code launches the stdio server from.
  
  Re-running `ndx init` merges into an existing `.mcp.json` rather than overwriting it — unrelated servers already present are left untouched. The command name respects a configured `cli.name` in `.n-dx.json` for projects that embed n-dx under another binary name.

### Patch Changes

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

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - fix(core): clamp findRelocationPort's near window to port 65535
  
  `findRelocationPort` scanned `requestedPort + 1` through
  `requestedPort + 83` without clamping to the maximum TCP port. For a
  requested port near the top of the range (e.g. `--port=65535` or
  `--port=65500`), the scan reached 65536 and beyond;
  `net.createConnection` throws `ERR_SOCKET_BAD_PORT` synchronously for a
  port outside 0–65535, which crashed `ndx start`'s relocation branch
  instead of relocating or falling back to 3117–3200.
  
  The near window's upper bound is now clamped to 65535. `isPortInUse` is
  also defensive: an out-of-range port is treated as "in use" rather than
  probed, so no future caller can reintroduce the same crash.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the full-suite gate's timeout configurable via `hench.fullTestTimeoutMs`.
  
  It was hardcoded (5 minutes originally, raised to a measured 15 in the same
  release this ships in). However generous the constant, a suite an operator
  cannot re-budget will eventually exceed it — and overrunning
  aborts a task whose work was already done and committed. Set the key in
  `.hench/config.json` or `.n-dx.json` (the latter wins, as with every other
  hench key); 0 disables the limit. `ndx config` documents it under a new
  "Hench test-gate settings" section, alongside `hench.fullTestCommand`.
  
  A timeout is now attributable like any other gate failure. It used to return
  zero packages, so the caller counted zero failures and printed
  `0/0 package(s) failed` for a run it was about to abort; the result now carries
  a `workspace` entry naming the command, how long it was given, and the key that
  moves it.

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Rewrote the MCP registration docs (README, the shared `project-guidance.md`, and `docs/guide/mcp.md`) to describe the tracked `.mcp.json` stdio flow as the default: the one-time Claude Code approval prompt for project servers, the `npx -y @n-dx/core rex mcp .` alternative when `ndx` isn't on `PATH`, and `--mcp-scope=local` for the legacy per-machine registration. HTTP transport (`http://localhost:3117/mcp/rex`) is now documented plainly as safe for a single project only — it points at whichever project currently holds the port — until the multi-project hub (0.7.0) lands.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex export` from writing an artifact that becomes the PRD backend.
  
  The in-tree guard rejected only paths inside `.rex/prd_tree/`, which is one
  directory short of the backends the store still falls back to:
  `FileStore.loadDocument` prefers `.rex/prd.md`, then `.rex/prd.json`, whenever
  the folder tree is absent.
  
  Two reachable outcomes, both of which the guard's own docblock claimed to
  prevent. `rex export --out=.rex/prd.json` passed: a bundle envelope carries
  `schema`, `title` and `items`, so it satisfies document validation and silently
  *becomes* the PRD on a checkout without the tree. And
  `rex export --format=narrative --out=.rex/prd.md` planted prose at the preferred
  legacy path, where the markdown parser then throws and blocks every rex command
  on that checkout.
  
  The guard now refuses anywhere inside `.rex/`, which is correct rather than
  merely wider: nothing is ever legitimately exported into the PRD storage
  directory. The bundle and narrative carve-outs in the project guidance are
  reworded to match what the code actually enforces.

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - fix(core): kill only the process listening on a busy port, never a client
  
  `killPortOccupant` selected its victim with `lsof -ti tcp:<port>` and took the
  first pid. That query lists every process holding a socket on the port —
  CLIENTS included, not just the LISTEN socket — and lsof prints pids in
  ascending order, so any older local process with a live or CLOSE_WAIT
  connection to the dashboard ranked above the listener and was SIGKILLed in its
  place. Observed while writing `tests/e2e/cli-start-two-projects.test.js`: a
  vitest worker still holding a CLOSE_WAIT socket 50 ms after its last
  `/api/status` request was killed instead of the server, which reported as
  `Worker exited unexpectedly` with no assertion, no attribution, and four
  orphaned dashboards left behind. Outside tests the candidate victim is a
  browser tab, a `curl`, or another CLI connected to the dashboard.
  
  The POSIX query is now `lsof -t -sTCP:LISTEN -i tcp:<port>`, so a client socket
  is not a candidate. The win32 `netstat` branch already matched on `LISTENING`
  and is unchanged apart from collecting every match rather than the first.
  
  Whom-to-kill is now a separate, pure decision (`selectKillTarget`) with three
  refusals, each a case where killing would be a guess: nobody listening, this
  process among the listeners (the self-preservation guard, which every
  in-process test of the peer path depends on), and several listening pids —
  SO_REUSEPORT or a pre-fork server. That last case now fails loudly, naming the
  pids, rather than killing one at random; `ndx start` reports the port as
  uncleared and the operator still has `--port=N`.
  
  This is the whom-to-kill half of the peer-dashboard work. The `/api/status`
  probe decides *whether* to kill, and it cannot protect a client, because a
  client is not what `/api/status` describes.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a narrative PRD rendering: `ndx prd export --format=narrative`.
  
  The PRD can now be written out as prose Markdown for a stakeholder rather than
  as a transport bundle. Epics become sections with a stated goal and a
  rationale, features become described capabilities, and acceptance criteria
  become readable sentences under a "How we'll know it's done" heading.
  Dependencies read as sequencing prose — "This follows on from …" — instead of
  `blockedBy` id lists. The default format is unchanged: `rex export --out=…`
  still writes the JSON bundle.
  
  No internal vocabulary reaches the page. Item ids, folder slugs, and the raw
  status and priority values are all omitted by construction: every status and
  priority is mapped to a phrase chosen to be disjoint from the enum literal it
  replaces (`in_progress` reads as "Under way now", `high` as "Should-have"), so
  a single regex sweep for the literals is a real proof rather than a spot check.
  A uuid pasted into a description is resolved to the title it names — or
  dropped, along with the parentheses it leaves empty, when the title is already
  in the sentence or resolves to nothing.
  
  `--item=<id-or-slug>` narrows the document to one subtree, so a single
  initiative can be handed over without the rest of the PRD. It resolves an item
  id, an exact title, a folder path, or a directory name copied out of
  `.rex/prd_tree/` — including the `-{id6}` suffix, which is often the only part
  of a directory name that still matches after a slug-rule change. An ambiguous
  reference lists the candidates instead of guessing, and a valueless `--item` is
  an error rather than a silent whole-PRD render.
  
  Finished and deleted work is excluded by default. `--include-completed`
  restores finished items for a retrospective-style document; deleted items stay
  out regardless. A finished container that still holds unfinished children is
  kept as a section — heading and goal only, with no state or criteria — so its
  children do not lose the context they sit in.
  
  Narrative output is deliberately one-way and is documented as such in the
  command help, the READMEs, and the PRD-invariant carve-out. The JSON bundle
  remains the only round-trip surface; nothing parses a narrative document back.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a portable PRD bundle: `ndx prd export` / `ndx prd import`.
  
  A PRD can now be carried between machines as a single JSON file, without
  sharing the repo or configuring a remote adapter. `rex export --out=<path>`
  serializes the whole loaded document; `rex import-bundle --in=<path>` rebuilds
  `.rex/prd_tree/` from it. The orchestrator exposes both as an `ndx prd`
  subcommand group; `ndx export`, the static-dashboard exporter, is unchanged.
  
  Fidelity is the point — a round trip preserves item ids, hierarchy, level,
  status, priority, description, acceptance criteria, tags, `blockedBy` edges,
  source, and attribution metadata. Verified against a 1392-item PRD with no
  field, parent, or membership differences.
  
  The bundle carries the PRD `SCHEMA_VERSION`. Import gates on it more strictly
  than the store's read path does: a bundle from a newer rex (newer envelope
  version, newer schema minor, or a different major) is refused before anything
  is written, rather than imported partially. `isCompatibleSchema` keeps its
  forward-compatible behaviour for ordinary loads.
  
  Import has a defined collision policy instead of last-writer-wins. `--merge`
  (the default) is additive: local items keep their content and placement, new
  bundle items are grafted onto the matching parent, an id that already exists
  anywhere in the tree is reported rather than duplicated, and ids whose content
  differs are listed with the local copy kept. `--replace` discards the local
  tree and needs confirmation, or `--yes` when not on a terminal. The tree write
  runs inside `store.withTransaction`, so it holds the PRD lock across the whole
  read-modify-write and cannot lose a concurrent writer's items.
  
  The bundle is a transport artifact, not a PRD backend: writing one inside
  `.rex/prd_tree/` is refused in code, and the PRD invariant — the folder tree is
  the sole writable PRD surface — is documented with an explicit carve-out.
  
  The rex-side importer is named `import-bundle` because `rex import` is a
  long-standing alias for `rex analyze`.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `prompt-census --write` stamping a commit the measurement did not come from.
  
  The census measures the working tree but stamped `.git/HEAD`, so a recording
  made from a dirty tree attributed its numbers to a commit that did not contain
  them. That is how the checked-in baseline came to name `3dda8b5b` while
  containing `JSON_OBJECT_ONLY`, a constant introduced by `0b57e2eb` — one of its
  own descendants. `--compare` then reported "(no surface changed)" across a range
  that had demonstrably changed a prompt, and the wrong SHA was published to the
  docs site.
  
  Note what would not have caught it: the token counts were right. Only the
  attribution was wrong, so no numbers-based check could have noticed.
  
  - `--write` now refuses a dirty tree, naming the reason. `--allow-dirty` records
    anyway and marks the stamp `<sha>-dirty` plus `dirty: true`, so an override
    can never be mistaken for a clean recording. The markdown header says so too.
  - Recordings carry a `contentHash` over the measured surfaces and skill bodies —
    provenance that needs no git and cannot disagree with its own contents.
  - `tests/e2e/prompt-census.test.js` fails when the repo no longer matches that
    hash, so a stale baseline cannot merge. Deliberately a content check rather
    than commit equality: recording dirties the baseline files, so committing them
    puts HEAD one ahead of the stamp and a SHA assertion would fail after every
    legitimate re-record.
  - The dirty check is whole-tree, so an unrelated edit blocks recording. It can
    report dirty when the measurement would have been faithful, but never clean
    when it would not — and a false clean is the bug being fixed.
  
  `scripts/prompt-census.mjs` joins the "Development scripts" entries in the
  ALLOWED set of `tests/e2e/architecture-policy.test.js`, since answering "does
  the tree match HEAD?" from `.git/` alone would mean reimplementing git's index
  and object store, and the mtime shortcut reports clean after a `touch`.
  
  The baseline is re-recorded from a clean tree in the following commit.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Build rex's and sourcevision's LLM prompts through `PromptEnvelope` so their cost
  is attributable per section rather than as one opaque total.
  
  Every prompt in `rex/src/analyze/` and `sourcevision/src/analyzers/` is now
  declared as a list of named sections against a shared per-package vocabulary,
  with the paired `*Prompt` function reduced to an assembly call. Prompt text is
  unchanged apart from removed doubled blank lines, where an absent conditional
  block used to leave its own padding behind — pinned by `prompt-text-identity`
  snapshot suites in both packages.
  
  The section-measurement helpers (`promptSectionCosts`, `dominantPromptSections`,
  `formatPromptSectionCosts`, `extractPromptSectionDiagnostics`) moved down to
  `@n-dx/llm-client` so rex and sourcevision, which sit below hench and cannot
  import from it, share one implementation instead of a copy; hench keeps only its
  CLI rendering and reaches the rest through its existing gateway.
  
  The prompt census now follows module-local helper calls when extracting static
  prompt text. Factoring duplicated text into a helper previously dropped it from
  the count entirely, so a refactor could silently shrink the baseline. Correcting
  this raised the recorded totals ~5% with no prompt growing — the earlier figures
  were an undercount — and the baseline records the revision so the jump is not
  misread as a regression. The baseline also now reports a per-section breakdown
  for each envelope-built package.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Pin `packages/core/assistant-assets/**/*.md` to LF, so a prompt's measured size
  does not depend on which OS checked the repo out.
  
  `.gitattributes` already pins `.claude/skills/**/*.md` — the copies `ndx init`
  generates — but not the sources those copies are written from. On a Windows
  checkout with `core.autocrlf=true` the sources came out CRLF, one extra byte per
  line, which inflated every shipped skill body: `ndx-adversarial-review` measured
  20,678 chars against the 20,512 recorded in
  `docs/analysis/prompt-token-baseline.md`.
  
  That failed `tests/e2e/prompt-census.test.js` with a 140-token drift no commit
  had caused, and the three skills living only in `.claude/skills/` measured
  exactly right — the pin was the difference. Because CI runs on LF it never saw
  it, so the guard was red on Windows and green in CI on the same commit.
  
  Re-recording the baseline would have been the wrong fix: it would stamp
  CRLF-inflated figures into the doc and flip the guard on the next platform
  switch. The tree is renormalized to LF instead, which leaves the index unchanged
  and stops a Windows publish shipping CRLF skill sources.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `scripts/prompt-census.mjs` and the checked-in prompt token baseline at
  `docs/analysis/prompt-token-baseline.md`. The census measures every LLM prompt
  surface across rex, sourcevision, hench, and core using llm-client's existing
  `budgetPreflight()` estimator, separates fixed prompt text from per-run context,
  and emits a before/after comparison against the recorded baseline.

- [#360](https://github.com/en-dash-consulting/n-dx/pull/360) [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - fix(core): relocate near the requested port, not into 3117–3200
  
  `runWeb`'s peer-relocation branch called `findFreePortInRange(port)`, whose
  defaults scan 3117–3200 regardless of what `port` actually was — the
  requested port was used only as the value to skip. An operator who set
  `web.port` or passed `--port` to steer around an environment that blocks
  3117 (corporate proxy, another service) had that instruction silently
  overridden: their second project relocated straight back into 3117–3200,
  typically landing on 3117 itself.
  
  `findRelocationPort` now scans upward from the requested port first
  (`port + 1` through `port + 83`, the same width as the default range) and
  falls back to 3117–3200 only when that neighbourhood is full. For the
  default port (3117) the near window already covers 3118–3200 exactly, so
  behaviour there is unchanged.
  
  `tests/e2e/cli-start-two-projects.test.js` and
  `tests/unit/web-port-occupant.test.js` are updated to assert the new
  contract; the latter adds direct coverage of `findRelocationPort`'s window
  selection for a port outside the default range, the default port itself, and
  the fallback path.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Remove instructions that rex prompts already gave elsewhere in the same prompt,
  and resolve a task-size contradiction between them.
  
  `TASK_QUALITY_RULES` sized a task at "one focused session (1-4 hours)" while
  `PRD_SCHEMA` asked for `loe` in engineer-weeks, `CONSOLIDATION_INSTRUCTION` asked
  for 0.5–4 engineer-week tasks, and decomposition splits anything over
  `taskThresholdWeeks: 2`. Nine builders carried the hours figure; eight of those
  also carried a weeks figure. `buildAssessmentEnvelope` — the prompt that decides
  whether to split or merge a proposal — graded week-scale work against the same
  hour-scale bar, so it recommended `break_down` on correctly-sized tasks. Sizing
  is now stated in engineer-weeks everywhere.
  
  Deleted as duplicated within the prompt that contained them: the markdown-fence
  prohibition (already in `OUTPUT_INSTRUCTION`), the "tasks need a description and
  criteria" and "no vague titles" rules (already in `TASK_QUALITY_RULES`, and
  restated twice more in `consolidation-guard` and `decompose`), the existing-PRD
  duplicate rule (kept in `ANTI_PATTERNS`, which reaches every prompt that had
  both), and `AUTO_PLACEMENT_INSTRUCTION`'s restatement of what `existingId` does.
  No instruction was removed from a prompt that did not still state it.
  
  Measured with `scripts/prompt-census.mjs`: rex drops from 16,121 to 15,217
  per-call tokens and 7,473 to 7,195 unique, a monorepo total of -904 / -278. A new
  `prompt-non-redundancy.test.ts` suite pins each rule against reintroduction, and
  both prompt suites now share one fixture list so a new prompt cannot be covered
  by one and missed by the other.
  
  Also adds `.hench/session-cache.json` to the `ndx init` ignore template, matching
  this repo's own `.gitignore`.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Scope a PRD bundle to one item: `rex export --item=<id-or-slug> --out=<path.json>`
  (also `ndx prd export --item=…`).
  
  A single epic or feature can now be carried between machines without exporting
  the whole PRD. The scope is a closure rather than a filter, because a filtered
  subtree is not importable:
  
  - the requested item arrives with **every descendant** beneath it, so the
    fragment is a working subtree rather than a childless stub;
  - it arrives with the **transitive `blockedBy` closure**, so a task blocked by
    an item in a different epic brings that item along. Keeping the edge without
    the target would import a dangling dependency; dropping the edge would lose
    sequencing information;
  - it arrives with the **ancestor containers** of everything selected, so import
    reconstructs the subtree at its original depth instead of re-parenting it to
    the root. That applies to items the closure itself pulled in, so a blocker
    from another epic brings its own chain of containers.
  
  Blockers are carried without their own descendants — a blocker is needed as a
  dependency target, not as a body of work, and expanding it downward would make
  a scoped export unbounded in practice.
  
  The export summary counts the requested subtree and the closure's contribution
  separately ("2 requested items … closure pulled in 1 blocking item and 3
  ancestor containers"), because a closure can reach well past what was asked
  for and a scoped export that quietly grows to half the PRD should say so.
  `--format=json` reports the same breakdown under a `scope` key.
  
  Every `blockedBy` id in a scoped bundle resolves to an item in the same bundle.
  An edge whose target is missing from the source PRD — already broken before the
  export — is dropped rather than carried, and reported with the item that held
  it.
  
  `--item` resolves through the same resolver the narrative rendering uses, so a
  uuid and a folder slug name the same item and one flag keeps one meaning. An
  unknown or ambiguous reference fails before anything is written, so a mistyped
  slug never leaves a whole-PRD bundle named after the item it meant to scope to.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Give every workflow skill an explicit stopping condition, and stop exempting the
  repo-local skills from the portability guards.
  
  A skill without a stated ending does not fail loudly — it overruns. The agent
  finishes what was asked, still holds context and tools, and continues into
  whatever looks adjacent: fixing the defect it was only asked to report,
  committing files it was only asked to inspect. Twelve of the thirteen skills
  ended on their last action with nothing marking it as the last;
  `ndx-adversarial-review` was the only one that said where it stopped. Each skill
  now closes with a `## Done when` section naming both the terminating action and
  what is deliberately out of scope, enforced by `skill-termination.test.js`.
  
  `skill-portability.test.js` derived its skill list from the assistant-assets
  manifest, so `iso-map`, `triage` and `dev-link` — which exist only in
  `.claude/skills/` — were checked by none of its guards. The suite passed anyway,
  so the gap was invisible. Both suites now enumerate through
  `tests/helpers/all-skills.js`, which covers manifest and repo-local skills alike
  and derives the local set by subtraction, so a new skill of either kind is
  covered as soon as it appears. The three were already portable; the guard simply
  did not know they existed.
  
  The prompt census now measures skill bodies (`--json`, `--compare`, and a table
  in the recorded baseline). A skill body enters context whole on invocation, so
  its size is a per-invocation bill in the same way a builder's fixed text is a
  per-call one — and it was the one category of prompt text edited by hand most
  often with no number attached. Recorded at 16,990 tokens across 13 skills, of
  which `ndx-adversarial-review` is 5,167. Skill totals are reported separately
  from per-call totals, never summed: a skill run and an analyze call are
  different events.

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the skill-authoring reference telling authors to write the one commit step
  CI rejects, and pin the shipped-vs-source difference instead of arguing about it.
  
  `SKILLS.md` documented the required commit step as
  `git commit -m "$(cat <<'EOF' … EOF)"`. `skill-portability.test.js` forbids
  exactly that construction in skill bodies — heredocs and `$(...)` are POSIX-only,
  and Git Bash is not part of Windows, so the step fails on a stock PowerShell at
  the *last* action of a skill, after all the real work is done. Following the
  documentation produced a skill that failed CI, and nothing could notice because
  the guard only read skill bodies, never the reference they are written from. The
  reference now teaches the file-based form the skills already use
  (`git commit -F`), and the guard covers it.
  
  `.claude/skills/<name>/SKILL.md` is generated as YAML frontmatter followed by the
  canonical body verbatim, so its line count runs about six higher than
  `assistant-assets/skills/<name>.md`. That gap has been read as drift; it is not.
  It is now asserted rather than assumed: the generated body must be byte-identical
  to the canonical source, and the frontmatter may carry only `name`,
  `description`, and `argument-hint`.
  
  That check closes a real gap. `assistant-body-drift.test.js` compares the
  committed artifact against what the generator produces today, so the two always
  agree — including when the generator is what is wrong. A renderer that dropped or
  reordered a section would have kept every suite green while shipping a skill that
  no longer matched the file its authors edit.

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

- [#356](https://github.com/en-dash-consulting/n-dx/pull/356) [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13) Thanks [@endash-shal](https://github.com/endash-shal)! - State the enrichment output contract once instead of four times, and fix the
  copy that had already drifted.
  
  Four builders across `enrich-batch.ts` and `enrich-per-zone.ts` each spelled out
  the response format for themselves — the severity enumeration, the "respond with
  only JSON" instruction, and the later-pass "add only new insights" rule. Written
  out four times, they had diverged: `buildSingleZoneLaterPassEnvelope` asked for
  `"Respond with ONLY a JSON object:"` where the other three asked for
  `"...(no markdown, no explanation)"`, so one enrichment path never forbade
  markdown at all.
  
  That drift was survivable rather than harmless — `tryParseJSON` strips fences
  before parsing, so a fenced response was recovered — which is precisely why
  nothing caught it. It still spent output tokens on a path that had asked for
  none, on a prompt that runs once per zone.
  
  The contract now lives in `prompt-envelope.ts` as `JSON_OBJECT_ONLY`,
  `ONLY_NEW_INSIGHTS`, and `findingsContract(withCategory)`. The category clause is
  the one intended difference between batch and per-zone prompts — per-zone is the
  minimal fallback path and `classifyFinding` derives a category from the finding
  text when the model omits one — so that difference is asserted rather than left
  to be rediscovered as drift.
  
  sourcevision drops from 2,332 to 2,194 unique fixed tokens. Per-call is
  essentially unchanged: the emitted text is byte-identical for every batch prompt
  (the `prompt-text-identity` snapshots pass untouched), and the one deliberate
  change adds the missing no-markdown clause to the per-zone later pass.
  
  Also records why `buildReviewerPrompt` lives in `packages/core/`. The
  orchestration-tier rule is spawn-only, and it constrains *imports*, not string
  composition: `pair-programming.js` imports nothing but Node built-ins and its
  core siblings, then hands the prompt to a spawned CLI. Moving it into a package
  would force core to import it, which is the thing the rule actually forbids.

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

- [#359](https://github.com/en-dash-consulting/n-dx/pull/359) [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Fix `ndx start`'s port-occupant self/peer check so a symlinked project path
  (or, on Windows, a different drive-letter/casing spelling) is recognised as
  the same directory instead of a peer.
  
  `classifyPortOccupant` compared `resolve()`d paths, which normalises
  separators and `..` segments but does not resolve symlinks and does not
  case-fold. A directory reached through a symlink (e.g. `ndx start ~/work`
  where `~/work` links to the directory already serving 3117) therefore
  compared unequal to itself, was classified as a peer, and `runWeb` relocated
  to a second port instead of restarting — leaving two dashboards live against
  the same `.rex/prd_tree/`. Foreground `ndx start` never writes a PID file, so
  this comparison is the only thing guarding idempotent restart in that case.
  
  Both sides are now canonicalised with `realpathSync.native` (falling back to
  `resolve()` when the path no longer exists, so a deleted directory degrades
  to the old lexical comparison instead of throwing).

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the pre-run git gate counting the warm-parent session cache as operator work.
  
  `.hench/session-cache.json` is rewritten on every orientation, but it was absent from `HENCH_RUNTIME_GITIGNORE_ENTRIES` and from both ignore lists, so `git add -A` in the pre-run commit gate swept it into commits — and a later run then saw its own write as one uncommitted file and refused to start. It is now ignored, discounted by the gate, and written by `hench init`. The ignore template test additionally pins every declared runtime artifact to both ignore files, so the constant can no longer drift away from them.
- Updated dependencies [[`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d), [`2a3028b`](https://github.com/en-dash-consulting/n-dx/commit/2a3028b436d836839c148a85a71819cf00fd925d), [`72609db`](https://github.com/en-dash-consulting/n-dx/commit/72609db1c4572f94ef25a2178d5cac2c17e241dc), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9)]:
  - @n-dx/rex@0.6.0
  - @n-dx/llm-client@0.6.0
  - @n-dx/web@0.6.0
  - @n-dx/hench@0.6.0
  - @n-dx/sourcevision@0.6.0

## 0.5.2

### Patch Changes

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a distilled repo primer and prefer it over CONTEXT.md as agent startup
  context.
  
  `ndx work` pipes CONTEXT.md plus a PRD excerpt into every task spawn. Even
  capped, that document is written for breadth — zone metrics, findings, route
  tables, import summaries — while a task starting work needs where things live,
  how to build and test, and what the conventions are. It needs that on every
  task and every retry, which is what makes distilling it worth one LLM call.
  
  `sourcevision analyze` now writes `.sourcevision/PRIMER.md`, and the
  orchestrator reads it in preference to CONTEXT.md, falling back silently when
  absent. The distiller lives in sourcevision rather than beside the pipe it
  feeds: orchestration is only allowed to spawn CLIs, and sourcevision already
  owns artifact generation, content-hash caching, and the one `callClaude` choke
  point with task-class routing. A side benefit is that the primer is now an
  artifact any consumer can read.
  
  Everything about it fails soft. The primer is cached against the analysis
  fingerprint, so it is regenerated only when the repository is re-analysed.
  Generation is skipped entirely unless the analysis already made successful LLM
  calls — the vendor and auth-mode getters both fall back to defaults when
  nothing is configured, so consulting them would have this attempt a spawn in
  every environment without a model, including CI. Output shorter than 200 or
  longer than 12,000 characters is rejected rather than truncated, because a
  primer cut mid-sentence would be inherited by every task in the loop while a
  missing one simply falls back to CONTEXT.md.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `.hench/reviews/` to the `ndx init` ignore template, and retire its stale
  `.rex/prd.json.lock` entry.
  
  The adversarial-review pass writes `.hench/reviews/<run-id>.json`, and hench's
  pre-run gate commits with `git add -A`, so a project that pasted the template
  into its `.gitignore` would commit machine-local review reports on the next
  run. The template also still named `.rex/prd.json.lock`, which `FileStore`
  stopped writing once both stores moved to `prdLockPath()` — now `.rex/*.lock`,
  which covers the folder-tree lock that is actually created.
  
  Nothing tested the template, which is how both entries drifted. It is now
  pinned against this repo's own `.gitignore`, so a runtime artifact added on one
  side and missed on the other fails a test instead of shipping.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - The isometric map can now show the two things an import graph structurally cannot: injection seams and runtime infrastructure.
  
  **Injection seams.** A callback or event seam runs the opposite way at runtime from the import that static analysis sees, so the map used to draw an arrow that was backwards for the behaviour people care about. Seams declared under `sourcevision.isoMap.injectionSeams` in `.n-dx.json` are now drawn in the runtime control-flow direction, in a distinct colour, with a panel listing the injected callbacks and stating plainly that the relationship was declared rather than inferred. `from`/`to` accept a zone id, a file path or a directory prefix.
  
  **Runtime infrastructure.** Queues, buckets, caches and databases have no import signature at all. Terraform `resource` blocks are now scanned and classified, and anything IaC does not cover can be declared under `sourcevision.isoMap.infrastructure`. Both render as a trailing column, attributed to the zones whose source names them — weaker evidence than an import, and the panel says so. Resource types with no architectural meaning (IAM roles, security groups) are skipped, and names too short or too generic to match on are refused.
  
  A declaration that cannot be drawn — both ends inside one zone, or naming a file no zone owns — is reported in the page footer rather than silently dropped.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - Iso map: one implementation, several gaps closed.
  
  The standalone skill script is now generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs` rather than hand-maintained, so the map has a single source of truth; `tests/e2e/iso-skill-drift.test.js` fails if the committed bundle goes stale, and also executes it. This removed a real divergence where the two copies disagreed on zone colours because one counted archetypes before mapping them to kinds and the other after — kinds are now resolved per file and counted once, which answers "what does this zone do" rather than "what is its most common file type".
  
  Also: the project scanner moved into the package (`iso-scan.ts`) and gained tsconfig `paths`, workspace-package and Go `go.mod` resolution, so a monorepo's own packages stop looking third-party; call-graph data, when present, adds per-edge runtime call counts with a Weight: imports/calls toggle and surfaces call-only edges as injected seams; output is reproducible (timestamps default to the HEAD commit time); key files link to source via the git remote; multi-layer edges route through corridors between rows instead of cutting through blocks; and the page gained a light theme, reduced-motion support, kind glyphs alongside colour, a skip link, and a tab order of one stop per zone instead of one per connector.
  
  New: `ndx iso`, `sourcevision iso --source=scan`, and `GET /api/iso-map` in the web dashboard.

- [#350](https://github.com/en-dash-consulting/n-dx/pull/350) [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8) Thanks [@dnaniel](https://github.com/dnaniel)! - New opt-in `sourcevision iso` command renders `.sourcevision/iso-map.html`: a standalone, dependency-free isometric map of the codebase. Each architectural zone becomes an extruded 3D block — footprint from file count, height from line count, colour from its dominant archetype — with import relationships drawn as connectors, click-to-inspect detail panels (metrics, insights, findings, key files, cross-zone edges), pan/zoom, and a legend that filters by kind. Never generated by `analyze`.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Register MCP servers against the project being initialised, not the caller's
  working directory.
  
  `registerMcpServers` shelled out to `claude mcp remove` / `claude mcp add`
  without a `cwd`, so the child inherited whatever directory the shell was in.
  Local scope — the default for `claude mcp add` — is stored per-directory, so
  `cd ~/repoA && ndx init ~/repoB` stripped repoA's `rex` and `sourcevision`
  registrations and replaced them with entries pointing at repoB. Both the remove
  loop and the add now run with `cwd` set to the resolved project directory, and
  the add states `--scope local` explicitly rather than relying on the default.
  
  This surfaced as the E2E suite destroying developers' own registrations: an
  init test's temp directory ended up registered in `~/.claude.json` under the
  repo the suite was launched from, leaving two MCP servers pointed at a deleted
  path. Recovery for an already-clobbered config is documented in TESTING.md
  under "Family 5".

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

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the warm-parent session foundation: `--fork-session` support, the
  orientation session cache, and the session-strategy config keys.
  
  The Claude CLI adapter gains `forkSession`, emitting `--fork-session` after
  `--resume` so a spawn can inherit a parent transcript under a new session id
  without mutating the parent. Forking without a session to fork from is
  suppressed rather than passed through — it would claim a fork that never
  happened.
  
  A new `agent/lifecycle/session-cache.ts` owns which orientation session
  exists and whether it is still safe to fork. Finding a parent is permissive
  (absent, unreadable, or corrupt cache files are all simply a miss, costing one
  orientation spawn); *using* one is strict, because a stale hit would have
  every task in a loop inherit an orientation describing a repo that has since
  changed. A parent is rejected, with a named reason, when the sourcevision
  analysis fingerprint changes, when it ages past `hench.parentMaxAgeHours`,
  when the vendor or model differs from the one it was built under, or when
  `--fresh` is requested.
  
  New config: `hench.sessionStrategy` (`fork` | `batch` | `cold`),
  `hench.tasksPerSession` (default 4), and `hench.parentMaxAgeHours` (default
  24), documented in `ndx config --help`. Strategy resolution degrades rather
  than errors: forking needs a CLI that resumes by session id, so other vendors
  and `provider=api` resolve to `cold`.
  
  No spawn behavior changes yet — the orientation pass and fork wiring that
  consume this land next.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Bound the spawns one task can make, and retry by resuming the failed session
  rather than cold-restarting it.
  
  **Breaking-ish behaviour change:** plan-mode re-spawns now consume the retry
  budget. Previously they were a separate per-attempt allowance, so four retries
  against up to three plan re-spawns each could reach twelve cold spawns for a
  single task — every one re-paying the harness prompt, the project
  instructions, and the repo re-exploration. Making them additive means a task
  that spends its budget entering plan mode gets correspondingly fewer failure
  retries than it did before.
  
  A hard ceiling sits on top of the retry budget, defaulting to 8 and
  configurable via `hench.maxSpawnsPerTask`. The two layers are not redundant:
  some re-spawn paths deliberately *avoid* charging the retry budget, because
  nothing was learned about the task — a plan-mode interception, the
  stale-parent fork fallback. The ceiling counts every spawn regardless of why
  it happened, so no future re-spawn path can reintroduce unbounded
  multiplication by simply not asking. It is checked before spawning, so it
  refuses to spend rather than reporting that the spending already happened, and
  hitting it fails the task with the full breakdown.
  
  Transient failures on the Claude CLI now retry by resuming the failed session
  — a plain resume, not a fork, since branching off the failure would leave the
  retry without the transcript it exists to continue. The cold-restart retry
  notice is suppressed on those retries: a resumed session *was* the previous
  attempt, so telling it that files from a prior attempt still exist and to check
  the current state before redoing work restates what it just did, and grows the
  prompt on every retry. Vendors with no resume on this path keep cold retries
  and keep the notice.
  
  Runs now record `spawnCount` and `spawnBreakdown`, so `ndx usage` can report
  retry overhead — a task that took four spawns to succeed reads differently
  from one that took one, and six plan re-spawns call for a different fix than
  six failure retries.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - List the known task classes in `ndx config --help`, and tell users when a
  route class looks mistyped.
  
  `llm.routes.<class>` and `llm.effort.<class>` accept any class name on
  purpose: glob keys (`prd.*`, `*`) are a routing feature, and a class added to
  the registry in a newer release has to keep working against an older CLI. The
  cost of that openness was silence — `ndx config llm.routes.agent.exceute heavy`
  was accepted, written, and matched nothing, so the user saw success and got the
  old model.
  
  Setting an unrecognized class now prints a note saying so, naming the closest
  known class when one is within an edit distance of three. Three catches the
  realistic typos — a transposition, a dropped or doubled character, a wrong
  suffix — without pointing `zone.enrich-scan` at `code.classify`; beyond it the
  note still appears and only the suggestion is withheld. It remains advisory in
  every case: the value is written, the exit status is unchanged, and globs and
  known classes stay silent.
  
  `ndx config --help` now lists all nineteen classes grouped by package with the
  tier each routes to by default, so the set is discoverable without reading
  source.
  
  The class list is duplicated from `@n-dx/llm-client`'s `DEFAULT_ROUTES` rather
  than imported, because orchestration-tier scripts must not import from
  packages — the same reason `LLM_VENDOR` is declared locally in that file. A
  new integration test fails when the copy drifts, checking not just the keys and
  tiers but that no known class is ever reported as unknown: that is the failure
  drift produces, and it hands the user advice that is exactly backwards.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Fork task spawns from a warm orientation session instead of cold-starting
  every task.
  
  A cold task spawn spends its first turns rediscovering the repo — layout,
  build and test commands, conventions — and pays that again on every retry and
  every task in a `--loop`. Hench now runs that once, in a read-only orientation
  session, and spawns each task as a fork of it (`--resume <parent>
  --fork-session`), so tasks arrive already oriented and every fork presents the
  same prefix.
  
  The orientation prompt is deliberately task-free: mention one task in it and
  every fork gets a different prefix, and the first task's framing leaks into
  the rest of the loop. Orientation is also read-only three times over — stated
  in the system prompt, restated in the task prompt, and spawned in `plan` mode
  — because that transcript is inherited by everything downstream.
  
  `cliLoop` runs once per task, so the cache, not loop plumbing, is what makes
  orientation happen once per loop; it also persists across separate `ndx work`
  invocations within the TTL. `ndx work --fresh` discards it, applied once at
  the start of a run rather than per task, so a loop re-orients exactly once.
  
  Two failure modes are handled deliberately. Orientation never fails a run: a
  spawn that errors, throws, or reports no session id simply yields no parent
  and tasks spawn cold. And because a cached parent is validated against its own
  metadata rather than the vendor's session store, a parent the CLI has since
  forgotten would otherwise fail every task in the loop — so the first failed
  fork drops the cache, disables forking for the rest of the run, and re-spawns
  cold without consuming retry budget.
  
  Runs record `parentSessionId` when they forked, making the saving auditable.
  Forking requires a CLI that resumes by session id, so other vendors and
  `provider=api` continue to spawn cold.
- Updated dependencies [[`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`3bd5f65`](https://github.com/en-dash-consulting/n-dx/commit/3bd5f65fe3c41f2f0ae93aac6333f7e0c9480fe8), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`0c9c31d`](https://github.com/en-dash-consulting/n-dx/commit/0c9c31da941fc92ec6ce14e6ed2e3d6c3fcfecae), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec)]:
  - @n-dx/rex@0.5.2
  - @n-dx/web@0.5.2
  - @n-dx/hench@0.5.2
  - @n-dx/llm-client@0.5.2
  - @n-dx/sourcevision@0.5.2

## 0.5.1

### Patch Changes

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Assisted skill runs now record what they cost, instead of zero.
  
  `hench record` writes the run entry for work driven through a skill rather than a spawned agent. Those entries carried empty token usage, on the stated grounds that "Claude Code does not expose its own token consumption to the running skill". That holds for the tool surface and not for the filesystem: Claude Code writes a JSONL transcript per session in which every assistant message carries the API's `usage` object, and it exports `CLAUDE_CODE_SESSION_ID` to the tools it runs. So the numbers were readable all along, and `ndx usage` plus the dashboard's per-item rollup were under-reporting every skill-driven task by its entire cost.
  
  Usage is now read from that transcript by default. Two things make the attribution honest rather than merely non-zero:
  
  - **Only the delta.** One session routinely completes several tasks — the session this was built in completed four — so a per-record session total would count the same tokens once per task. A watermark per session lives in `.hench/usage-cursors/`, and each record claims only what accumulated since the last one. It survives transcript compaction by falling back from message uuid to a count, and says when it did.
  - **Only after the work started.** The watermark cannot help the FIRST record in a session, which would otherwise claim everything spent before the task began. Measured against a live session: 549 messages and 127M cache-read tokens for one task. `--startedAt` now doubles as the earliest spend a record may claim, and `/ndx-work` captures it when it marks the task in progress.
  
  Precedence is explicit `--input-tokens`/`--output-tokens`/`--cache-*-tokens` flags, then the transcript, then zeros. A missing or unreadable transcript never fails the record — an unrecorded run is worse than one missing its tokens — and the command reports which happened. `--no-tokens` opts out; `--session` and `--transcript` override discovery.
  
  The `assisted` flag keeps its meaning as provenance (skill vs agent) rather than "no usage", and `turns` is now the transcript's message count, which is a real API-call count.
  
  Skills that mutate state — `/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config` — record their runs as a documented step. Planning-style skills record against `skill:<name>`, which `get_token_usage` reports in its existing `orphans` bucket: work that produced many items should not be charged to one of them.
  
  Also fixes a test-isolation hazard this created. `CLAUDE_CODE_SESSION_ID` is exported to `pnpm test` as well, so the suite began reading the ambient live transcript and asserting against numbers that change between runs — green in CI, unreproducible locally. `tests/setup-session-env.js` clears it in every worker, the same shape as the existing `setup-color-env.js` and for the same reason.

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx config <key>` no longer lets a same-named directory shadow the key at the pre-dispatch layer.
  
  The config handler already resolved the ambiguity correctly — a known config key beats a directory, because a key is an exact match against a closed set while a directory name is arbitrary — but the pre-dispatch resolver (`resolveExistingDir`, which decides where to read `.n-dx.json` and check initialization) still used disk existence alone. In a project containing a `hench/` subdirectory, `ndx config hench` read config from `./hench` (silently dropping command timeouts and experimental flags, since the missing `.n-dx.json` falls back to `{}`) and printed "Project setup incomplete" for a fully initialized project.
  
  `resolveExistingDir` now accepts a skip predicate and, for the `config` command, applies the handler's own exported `isConfigKey` tiebreaker — so both layers agree. `./hench` and `../hench` remain unambiguous ways to name the directory, and a trailing directory argument in `ndx config <key> <value> <dir>` still resolves.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop a directory from shadowing a config key in `ndx config`
  
  `n-dx config [dir]` and `n-dx config <key>` occupy the same positional slot, and
  the tie was broken by asking the filesystem: if the argument named something that
  existed, it became the directory. In a project that happened to contain a
  subdirectory named after a config section, that silently discarded the key —
  `ndx config hench` in a project with a `hench/` directory read the config of
  `./hench`, found none, and reported a fully-initialized project as uninitialized.
  
  A known key now wins, because a key is an exact match against a closed set
  (`PROJECT_SECTIONS`, the package names, and `language`) while a directory name is
  arbitrary. `./hench` and `../hench` still unambiguously mean the directory: their
  first dot sits at index 0, so the root segment is empty and never matches a
  section. A positional that is not a known key is resolved as a directory exactly
  as before, so `ndx config ./some/project` is unaffected.

- [#339](https://github.com/en-dash-consulting/n-dx/pull/339) [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12) Thanks [@endash-shal](https://github.com/endash-shal)! - Correct stale zone-governance documentation and stop leaking n-dx internals into generated instruction files
  
  The zone fragility tables named six zones that no longer exist under those IDs
  (`web-shared`, `crash`, `viewer-ui-hub`, `prd-fix-command`, `chunked-review`,
  `hench-agent`) with metrics that no longer match any analysis. Because
  `CLAUDE.md` is generated from `assistant-assets/`, those n-dx-specific zone
  names and numbers also shipped into every `ndx init` target.
  
  The generated surfaces now carry only the threshold rule plus instructions to
  read live values; n-dx's own measured inventory moved to `ZONES.md`, which is
  repo-internal and not templated downstream.

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - The skill bodies' POSIX timestamp example works on BSD date now.
  
  Every recording skill's first step named `date -Is` as the POSIX example — GNU-only. On macOS (BSD date), the platform this project is primarily developed on, it exits 1 with `invalid argument 's' for -I`. All 18 skill-body copies now prescribe `date -Iseconds`, valid on both GNU and BSD date, and `tests/e2e/skill-run-recording.test.js` rejects the bare form so it cannot return (with the lookahead that keeps `date -Iseconds` itself legal).

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Document what the assisted-run token capture added, and the flake family it exposed.
  
  `.hench/usage-cursors/` now appears in the key-files table (`project-guidance.md`, so both `CLAUDE.md` and `AGENTS.md` carry it) and in the gitignore guide's copy-paste block and per-path table — it is machine- and session-local, and committing one collides between machines and puts a session id in history.
  
  The skills guide gains a shared section on what every state-mutating skill does at the end. The per-skill step lists are summaries that omit the commit step, so adding a lone "record the run" step to each would have implied they were exhaustive; the shared note covers both, including why planning-style skills record against `skill:<name>` and land in `get_token_usage`'s `orphans` bucket.
  
  TESTING.md gains **Family 4 — Ambient environment leaking into the suite**, which is the pattern behind three separate defects rather than one: `FORCE_COLOR` (24 failures across 8 files), whether `sh` resolves on PATH (21 failures across 5 files **plus 5 vacuous passes**), and `CLAUDE_CODE_SESSION_ID` (the suite reading a live, growing transcript). CI set none of them, so all three were green in CI and red only for humans. The rules record the setupFile mechanism, why a genuine environment dependency gets guarded rather than removed, and that an ambient dependency which breaks assertions usually also satisfies some for the wrong reason — so an audit should look for the vacuous passes too. The section intro said "Two failure families" while three were documented below it.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Attribute every commit n-dx creates.
  
  Three commit sources omitted the `Co-Authored-By: En Dash's n-dx <n-dx@endash.us>`
  trailer: `/ndx-adversarial-review`'s commit step, the dashboard deploy commit in
  `export.js`, and the `chore: n-dx init` baseline commit in `git-preflight.js`.
  The trailer is what routes a commit to the n-dx identity — `merge-history.ts`
  parses it for the dashboard's merge graph and GitHub reads it for the
  contribution graph — so those commits were invisible to both, silently.
  
  The two source-level commits now build their message with `buildCommitMessage()`
  from the new `packages/core/commit-trailers.js`, tagged `export/dashboard` and
  `init/baseline`. The skill gained the same HEREDOC commit step the other
  file-modifying skills use.
  
  The root cause was documentation: SKILLS.md rule 2 showed a bare
  `git commit -m "<skill>: <desc>"` with no trailers, so a skill written against
  the documented rule came out wrong. Rule 2 now shows the trailer-bearing HEREDOC
  as the canonical template, and the `N-DX*` namespace is documented — `N-DX:` for
  what produced the commit, `N-DX-Item:` for which item, `N-DX-Status:` for what
  changed. They are three keys with distinct meanings, not variants to unify.
  
  Skills now declare `"commits": true` in the manifest, and
  `tests/e2e/skill-commit-isolation.test.js` classifies on that flag instead of a
  hardcoded array. Deriving the classification from body content would have made
  the read-only assertion tautological; reading declared intent means a skill that
  commits without declaring it fails loudly. A further assertion pins core's
  trailer string byte-identical to hench's, since the orchestration tier cannot
  import from packages and the string is necessarily duplicated.

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx init` now registers the rex-prd merge driver.
  
  Alongside the existing `.gitattributes` EOL pins, init appends `.rex/prd_tree/** merge=rex-prd` (same idempotent pattern-keyed mechanism — a user's own line for the pattern wins) and, inside a git repository, registers `merge.rex-prd.name` and `merge.rex-prd.driver` (`rex merge-driver %O %A %B`) in git config. An already-set driver — including a user-customized command — is left untouched, re-running init changes nothing, and outside a git repo the registration is silently skipped: init never fails over it. Together with the `rex merge-driver` command this makes PRD tree merges three-way and frontmatter-aware out of the box.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Add the `/ndx-adversarial-review` skill: review by attack rather than by inspection.
  
  Invoked bare it attacks the working or branch diff; given a task ID it attacks
  the claim that the task is done, criterion by criterion; given a name or topic it
  finds the matching PRD item and confirms it with the user before starting. Since
  rex exposes no search tool, that resolution enumerates `.rex/prd_tree/` — whose
  directory names are the item slugs — rather than guessing IDs, the same technique
  the duplicate check uses.
  
  The skill runs two passes. Pass 1 works a fixed rubric — unimagined inputs,
  failure paths, concurrency, platform, contract drift, test quality, the
  acceptance criteria themselves — and drops any finding it cannot give a concrete
  trigger or cannot defend against its own refutation attempt. Pass 2 then asks
  whether each survivor is worth acting on at all: reachable by a real caller,
  already covered upstream, worth what the fix costs, and in scope for this change.
  A real defect that lands on "not worth fixing" is reported as such rather than
  inflated into work.
  
  Ground truth includes the project's own checks, discovered rather than assumed —
  `.rex/workflow.md`, the manifest scripts, or the CI config name them, and only
  read-only ones are run. A red result is a finding whose repro is already written;
  a green one bounds the review without ending it.
  
  Nothing is written until the user rules on the findings. Approved findings are
  then checked against what the PRD already tracks — matched on the defect rather
  than the wording — so a repeated review does not bury the original item under
  near-duplicates: an already-tracked finding is either extended via `edit_item`,
  when the review has something new to say, or skipped with the existing item's ID
  reported. Genuinely new findings become items carrying the failure scenario,
  candidate solutions, and failing acceptance criteria.
  
  The skill never edits source or applies a fix. Fixing an approved item is a
  separate `/ndx-work` run.
  
  The run it records is scoped to itself: Step 1 notes an ISO-8601 timestamp
  before reading anything and Step 7 passes it as `--startedAt`, so a review
  invoked partway through a long session claims only what the review spent rather
  than everything that came before it.
  
  Captured items are filed against `add_item`'s real parameters rather than
  described in prose, so acceptance criteria reach the `acceptanceCriteria` array
  where `verify_criteria` and the dashboard can read them, and severity maps
  one-to-one onto `priority` instead of being buried in the description.
  
  Claim mode calls `verify_criteria` with `runTests: false`, so resolving the
  target reads the criteria-to-test mapping without spawning the project's
  configured test command — a command that step has not discovered or vetted. The
  checks discovered in Step 2 are stated to be the only ones permitted to execute
  tests.
  
  Diff mode resolves the default branch with
  `git symbolic-ref --short refs/remotes/origin/HEAD` rather than assuming `main`,
  and asks which branch to compare against when `origin/HEAD` is unset — so the
  skill's primary entry mode works in a repo on `master` or `develop` instead of
  failing with "fatal: ambiguous argument".

- [#342](https://github.com/en-dash-consulting/n-dx/pull/342) [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `ndx work --review`: an adversarial review pass that runs after a task's
  changes validate and before the commit prompt, so must-fix repairs ship in the
  same commit as the work they repair.
  
  **`--review` changes meaning; the old gate is now `--approve-diff`.** The flag
  previously showed the diff and prompted for approval. That gate is unchanged
  apart from its name — pass `--approve-diff` to get it. The two are independent
  and compose: the review pass runs first, so a human answering the diff prompt
  sees the repaired tree rather than the one the implementer left behind. Runs
  that pass `--review` print a line saying where the old behavior went.
  
  **The reviewer resumes the work session.** On the Claude CLI the pass re-enters
  the session that just did the work (`--resume <session-id>`, captured from the
  `session_id` that `--output-format stream-json` stamps on every line) and runs
  it on a stronger model. That inherits what the diff cannot show: which
  approaches were tried and abandoned, which files were read and found
  irrelevant, what the implementer believed it was doing. Vendors whose CLI has no
  resume equivalent — and any run where the session id never arrived — fall back
  to a fresh reviewer seeded with the task, its acceptance criteria, and the
  change's scope.
  
  Resuming invites anchoring, so the reviewer's system prompt is built against it:
  prior reasoning in the conversation is named as evidence under test rather than
  a position to defend, and every finding must carry inputs-to-wrong-result
  concrete enough to be refuted. Findings that cannot be triggered are dropped
  rather than softened.
  
  **Review gets its own model tier, `REVIEW_MODELS`.** Review is read-heavy and
  judgment-dense but short — one diff, one pass — so its token volume is a
  fraction of the run it audits and a stronger model costs little in absolute
  terms. Claude defaults to `claude-opus-5` ($5/$25 per MTok): Opus-tier reasoning
  at the same input price as Opus 4.8, where `claude-fable-5` would cost twice as
  much for a single pass. Codex and Google resolve to their existing top tier;
  local uses whatever is loaded.
  
  Resolution is `--review-model` → `llm.<vendor>.reviewModel` → `llm.reviewModel`
  → the vendor default. `llm.model` and `llm.<vendor>.model` are deliberately
  excluded: inheriting the execution model would mean a project that pins a cheap
  executor silently gets a cheap reviewer, which defeats the reason the tier
  exists. `--review-model` without `--review` is an error rather than a no-op.
  
  **Findings are triaged, not just listed.** Autonomous runs apply the verdict
  policy directly — `must-fix` is repaired in-session with the test that would
  have caught it, `should-fix` and `out-of-scope` are captured as rex items after
  checking `.rex/prd_tree/` for an existing item describing the same defect, and
  `not-worth-fixing` is reported with its reason. Interactive runs still stop and
  ask before writing anything to the PRD. The reviewer is barred from committing,
  from changing task status, and from any command that rewrites analysis or PRD
  state concurrently with the run.
  
  **A broken review never fails a valid task.** By the time the pass runs, the
  task's own completion validation has already passed, so a reviewer that dies,
  writes nothing, or writes something unparseable tells us nothing about the work
  — the failure is reported and the run continues. The distinction is preserved
  on the run record (`run.review`) rather than left in terminal scrollback,
  because a review that silently did not happen must not read as one that found
  nothing. Report transport is a JSON file under `.hench/reviews/<run-id>.json`,
  keyed by run so a re-review keeps both, and cleared before each pass so a stale
  report can never be read as the current one. Unknown enum values in a report
  are coerced toward alarm — an unrecognized severity becomes `critical`, an
  unrecognized action becomes `failed` — so a garbled field demands attention
  instead of reading as clean.
  
  The pass requires the CLI provider and errors out on `provider=api` rather than
  accepting the flag and doing nothing. Its token usage is charged to the run it
  reviewed, so `ndx usage` reflects what `--review` actually costs.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop resolving a tool subcommand as the project directory.
  
  Before dispatch, `main()` infers a directory to read `.n-dx.json` from and to
  check whether the project is initialized. It used the same last-positional rule
  the command handlers use — but a tool-delegation call still carries its
  subcommand in those args, so `ndx hench record --task=X --status=completed`
  resolved the project directory to `./record`, and `ndx rex status --format=json`
  to `./status`.
  
  Two things followed, neither of them loud. `checkProjectStaleness` looked for
  `.rex`, `.hench` and `.sourcevision` under a path that does not exist and printed
  "Project setup incomplete — run ndx init to initialize" in a fully initialized
  project. And `loadProjectConfig` read `.n-dx.json` from that same path and fell
  back to `{}`, so `commandTimeouts` and BETA experimental flags silently stopped
  applying to any `ndx rex|hench|sourcevision|sv <subcommand>` call without a
  trailing directory. The delegated tool itself was unaffected — it resolves its
  own directory — which is why the symptom was a false warning and dropped config
  rather than a failed command.
  
  That call site now uses `resolveExistingDir`, which accepts a positional only
  when it names a real directory. This is safe there specifically because the
  result is never an operation target: a path that does not exist has no config to
  read, so falling back to the cwd loses nothing. The 25 handler call sites keep
  the existing rule, so a directory the user intends to create — `ndx init newdir`
  — still resolves as before. The stricter rule also fixes the same misfire for a
  non-path positional, such as `ndx rex add "some description"`.

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - Skill commit steps no longer prescribe a POSIX-only heredoc.
  
  Five skill bodies (`ndx-adversarial-review`, `ndx-capture`, `ndx-config`, `ndx-plan`, `ndx-reshape`) built their commit message with `git commit -m "$(cat <<'EOF' … )"` — a construct that does not exist in PowerShell or cmd.exe, and Git Bash is not part of Windows (it arrives with Git for Windows, whose `usr/bin` is not on PATH outside Git Bash itself). The failure landed at the skill's LAST step, after all real work was written; worse, an assistant improvising around the parse error could drop the `Co-Authored-By` trailer, which fails silently — the commit lands but vanishes from the dashboard's merge graph.
  
  The bodies now instruct the assistant to write the message with its file-writing tool to a scratch file and run `git commit -F <file>` — no shell quoting anywhere, so the trailer bytes survive in every shell. Repeated `-m` flags are explicitly named as unsafe (git's blank-line joining splits the trailer block). `tests/e2e/skill-portability.test.js` now rejects `cat <<` and `$(cat` in any skill body, so a sixth copy cannot creep in.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - File PRD items against `add_item`'s real fields in every skill that creates them.
  
  `/ndx-plan`, `/ndx-capture`, and `/ndx-reshape` described item content in prose —
  "create it with appropriate descriptions, acceptance criteria, and parent
  placement" — without naming the parameters those map to. Two things went wrong
  as a result. Acceptance criteria landed in `description` prose while the
  `acceptanceCriteria` array stayed empty, and that array is what `verify_criteria`
  and the dashboard's requirements view read, so the criteria could never be mapped
  to tests or checked by a later review: the item looked complete while being
  quietly unverifiable. And `level`, which is required with no default, was guessed
  per run, so items of the same kind landed at different levels.
  
  Each skill now names the fields it actually needs rather than carrying a copy of
  the same table. `/ndx-plan` — which files in bulk and had no coverage at all —
  gained the full mapping including `priority` and `source`. `/ndx-capture` already
  handled level, parent, and priority through its own steps, so it gained the
  `acceptanceCriteria` and `source` guidance it lacked. `/ndx-reshape` creates
  containers rather than work items, so it gained explicit `level` and `parentId`
  for those, and the criteria rule for the rarer case where a container has a
  testable outcome of its own.
  
  A new test, `tests/e2e/skill-item-fields.test.js`, derives its skill list from the
  manifest, so a future skill that creates items is covered the moment it is added.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Scope every skill's run record to the skill's own work.
  
  `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, and `/ndx-config` all ended with
  `ndx hench record` but never captured a start time, so none could pass
  `--startedAt`. Without it the first record in a session has no watermark to work
  back from: `readUsageDelta` opens its window at the top of the transcript and the
  record claims every token the session spent before the skill was invoked. A
  `/ndx-capture` run measured while fixing this claimed 21,343,032 tokens across
  171 messages — an entire session's unrelated work charged to one captured item.
  
  Each of the four now notes the current time in ISO-8601 before it starts and
  passes it as `--startedAt`. `/ndx-work` already did, but prescribed `date -Is`,
  which does not exist in PowerShell; it and the four new instructions name both
  `date -Is` and `Get-Date -Format o` as examples of whatever the shell provides.
  
  A new test, `tests/e2e/skill-run-recording.test.js`, derives its skill list from
  the manifest rather than hardcoding it, so a future skill that records runs is
  covered the moment it is added: it must pass `--startedAt`, say where the value
  comes from, and not prescribe a POSIX-only command to get it.

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start stop` no longer warns that a server "did not exit" when it did.
  
  `terminateTreeByPid` returns whether a pid stopped answering signal 0, which is not the same question as whether the intended process exited: `kill(pid, 0)` succeeds for a zombie — exited but not yet reaped — and for a PID that has since been recycled. SIGKILL is unblockable, so a still-signallable pid after one is weak evidence of survival and strong evidence of nothing.
  
  The two stop paths disagreed about that. `cli.js` discarded the result and explained why; `web.js` branched on it and logged `Server (PID N) did not exit within Nms of SIGKILL.` — directly above the `Stopped ...` line it printed anyway. Stopping a server that exited cleanly could produce both lines, and the warning was the wrong one.
  
  `web.js` now discards the result too. The rationale lives in one place — the contract on `terminateTreeByPid` — with both call sites pointing at it instead of carrying their own copy, and the `@returns` tag corrected: it claimed "whether the pid is gone", contradicting the prose four lines above it.
  
  Where a stop path genuinely needs to report failure, the signal-0 probe belongs *before* the kill, which is where `cli.js` already separates EPERM ("exists, not ours to signal" — a real failure) from ESRCH ("already gone" — success). That behaviour is unchanged.
  
  Guarded by a source assertion rather than a behavioural test: misreporting needs an unreaped zombie in the window between exit and reap, which cannot be staged deterministically, whereas the invariant that produced it — no caller consults the result — checks exactly.

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

- [#332](https://github.com/en-dash-consulting/n-dx/pull/332) [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce) Thanks [@endash-shal](https://github.com/endash-shal)! - Review follow-ups on session usage recording and the adversarial-review skill.
  
  - **The usage watermark can no longer rewind.** When the newest scanned transcript entry carried no `uuid`, the cursor kept the previous `lastUuid` while `consumed` advanced past it — and `lastUuid` wins on the next read, so everything between the two was claimed twice. The uuid watermark is now dropped when the tail has none, so the count governs and nothing is re-claimed. Latent rather than live (real transcripts stamp a uuid on every usage-bearing entry), but `uuid` is typed optional and the input is untrusted JSON parsed line-by-line, and the failure mode was silent inflation of exactly the number this module exists to make trustworthy.
  - **`CLAUDE_CONFIG_DIR` is honoured when locating the transcript.** `resolveTranscriptPath` accepted a `configDir` option but nothing outside its own test passed one, so a user who relocated their Claude config tree silently recorded zero tokens. The environment variable is now consulted between the explicit option and the `~/.claude` default.
  - **Transcript discovery probes with `stat` instead of a full read.** The existence probe read the whole file and threw the bytes away; the caller then read it again — twice the I/O on transcripts that reach tens of MB.
  - **`ndx-adversarial-review` stages only what it wrote.** Its commit step inherited the house `git add -A`, but this skill's diff mode takes the dirty working tree as its review subject, so unscoped staging swept the user's in-progress work into a commit attributed to the review. It now runs `git add .rex/prd_tree/` and scopes its porcelain check the same way; the other committing skills, which never take a dirty tree as input, keep `git add -A`.
- Updated dependencies [[`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce)]:
  - @n-dx/rex@0.5.1
  - @n-dx/hench@0.5.1
  - @n-dx/web@0.5.1
  - @n-dx/sourcevision@0.5.1
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface concise re-authentication guidance when a provider rejects credentials, and stop dumping raw JSON error payloads.
  
  A new canonical helper in `@n-dx/llm-client` (`authFailureGuidance` / `authFailureMessage`) is the single source of truth for auth-failure wording: it names the provider, states the cause (`Invalid or expired credentials`), and gives the exact fix — `claude logout && claude login`, `codex logout && codex login`, or `ndx config llm.google.api_key <KEY>`. Every entry point now reads identically:
  
  - **`ndx init` / `ndx config llm.vendor`** — the core preflight (`packages/core/config.js`) replaces the verbose `Details: <raw JSON>` dump with the concise, ANSI-colored guidance (red headline, yellow remediation). The NDX error code (e.g. `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`) is demoted to a dim secondary line instead of the headline, and JSON payloads are never printed. A missing Google key gets a distinct "No API key configured" message.
  - **`ndx work`** — the runtime LLM providers already throw `AuthFailureError`; its message is now the canonical, JSON-free line.
  - **`ndx plan` / `ndx analyze`** — rex/sourcevision route auth errors through the shared classifier and (for rex) render `AuthFailureError` with the shared remediation.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Detect the project's CLI command name from the package.json bin field and record it as cli.name in .n-dx.json during init; manual overrides via `ndx config cli.name` are preserved.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Redact secrets in the logged `commandLine`, and cover every secret pattern in the twin tests.
  
  `cli-log` redacted `args` but wrote `commandLine` through verbatim. On Windows that is the same data twice: `buildWindowsCliCommandLine(binary, args)` embeds the argv into the command line, so a key that `redactArgs` correctly replaced with `<redacted>` in the `args` field reappeared in full in `commandLine` on the same log line of `claude_commands.log`.
  
  `redactArgs` cannot be reused for this, and reaching for it makes things worse rather than better. It iterates its argument, so handing it a string walks the individual characters — every pattern is anchored (`^sk-ant-…`), no single character matches, and the field is emitted as an array of letters with the secret fully intact:
  
  ```json
  "commandLine":["c","l","a","u","d","e"," ","-","-","a","p","i","-","k","e","y"," ","s","k","-","a","n","t","-","S","E","C","R","E","T"]
  ```
  
  So both twins gain a `redactCommandLine(line)` that tokenises on whitespace, preserves the original spacing, and applies the same `SECRET_FLAGS` / `SECRET_PATTERNS` tables through the surrounding quotes that `buildWindowsCliCommandLine` adds. Returns a string, as the field's own type always claimed.
  
  **Two of the four `SECRET_PATTERNS` were never exercised.** The parity block drove five fixed records, and between them they only ever hit `gh[pousr]_`; the per-twin behaviour block added `sk-ant-`. Nothing anywhere passed an `AIza…` (Google AI Studio) or a non-Anthropic `sk-…` token, in either twin. Either pattern could have been dropped from either copy with the whole suite green — and a dropped pattern means the key it matches is written to disk in plaintext. Both now have cases, plus `redactCommandLine` coverage per twin and a secret-bearing `commandLine` in the parity records.
  
  Verified by deleting the `AIza` pattern from the core twin alone: 4 assertions fail across both the behaviour and parity blocks, where previously that deletion was invisible.
  
  Also corrects both twins' TWIN docblock, which pointed at `tests/unit/cli-log-parity.test.js`. No such file exists — the guard is the `cli-log twin parity` block inside `tests/unit/cli-log.test.js`. A pointer whose only job is telling the next person where the tripwire is should not name a file that was never there.

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Close out Codex workflow parity ([#122](https://github.com/en-dash-consulting/n-dx/issues/122)) and fix the skill-tracking asymmetry ([#284](https://github.com/en-dash-consulting/n-dx/issues/284)).
  
  - **Body-drift regression test** — a new e2e test regenerates the assistant artifacts from the canonical source (`assistant-assets/`) and asserts the committed `CLAUDE.md`, `AGENTS.md`, and every vendor `SKILL.md` match the generator. This closes the last acceptance gap of [#122](https://github.com/en-dash-consulting/n-dx/issues/122) (tests now fail on body drift, not just inventory drift). It immediately caught a real drift: the committed `CLAUDE.md` carried a `## Changeset Versioning` section that was never in the canonical `project-guidance.md`, so `AGENTS.md` silently lacked it — that section is now in the shared source and both instruction files carry it.
  - **[#284](https://github.com/en-dash-consulting/n-dx/issues/284) — commit both:** the generated Claude `ndx-*` skills were gitignored while the Codex skills were committed, so cloned checkouts lacked the `/ndx-*` skills for Claude until re-init. `.claude/skills/` is removed from `.gitignore`, the generated skills are committed (and LF-pinned in `.gitattributes`, matching `.agents/skills/`), and `ndx init` now warns via `checkSkillTracking()` when an enabled assistant's skill directory is gitignored.
  - **Docs sweep:** the web package README and the troubleshooting guide no longer describe MCP setup as Claude-only.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `ndx export` work on Windows.
  
  `ndx export --deploy=github` could not succeed on Windows. Two independent blockers, both now fixed and both verified end-to-end.
  
  **1. The dynamic import aborted the command immediately.** `export.js` did `await import(resolvePackagePath(...))` with a bare absolute path, and Node's ESM loader rejects that on Windows:
  
  ```
  ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'
  ```
  
  The command died before doing any work — before generating the dashboard, let alone deploying. Now wrapped in `pathToFileURL(...).href`, the same fix `tests/e2e/published-package-loadability.test.js` already applies for this exact error. This was not in the original bug report; it surfaced only when the flow was actually run on Windows.
  
  **2. POSIX-only shell commands in the deploy path.**
  
  - `rm -rf "<path>"` per worktree entry. `rm` is not a cmd.exe command, and although Git for Windows ships `usr/bin/rm.exe` it is not normally on PATH. With no try/catch this threw and aborted the deploy. Replaced with `rmSync(path, { recursive: true, force: true })` — no shell at all, and `force: true` carries the `-f` intent.
  - `git rm -rf . 2>/dev/null || true`. Both `2>/dev/null` and `|| true` are POSIX sh constructs. The tolerate-failure intent moved into a JS `try/catch`, which is also clearer about *why* it is tolerated: a fresh orphan branch legitimately has nothing to remove.
  
  **All 16 remaining `execSync` command strings converted to argv** via `execFileSyncCli` from `win-spawn.js`. The interpolated ones hand-quoted paths (`tmpWorktree`, `dir`) that break on Windows when a project path ends in a backslash — the trailing backslash escapes its own closing quote — or contains `&`/`^`. `rex` also needs the `.cmd` shim handling that helper provides.
  
  Worth stating precisely: the unquoted `${branch}` interpolations were **not** an injection vector, because `branch` is the hardcoded constant `"n-dx-dashboard"`. The genuine risk was the project-derived paths.
  
  `export.js` is no longer exempt from the shell-string architecture guard; that exemption was retired rather than left standing.
  
  Verified against a scratch repository with a **local bare `origin`**, from a project directory named `e & p (v2)` — a space, an `&`, and parentheses. Both deploy routes pass: the orphan-branch creation path on first run, and the existing-branch `worktree add` path on the second. 28 files pushed, no `.ndx-deploy-tmp` left behind. No real deploy target was ever contacted.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Route `ndx init`'s Claude CLI invocations through the Windows-safe spawn helper.
  
  `packages/core/claude-integration.js` built six `execSync` command strings by hand — the MCP `remove`/`add` registration pair and four `--version` discovery probes. Every argument involved is a filesystem path (the claude binary, the resolved MCP entrypoint, the project directory), and the surrounding quoting was a bare `"`:
  
  ```js
  execSync(`"${claudeCmd}" mcp add ${name} -- node "${bin}" ${descriptor.mcpCommand} "${absDir}"`)
  ```
  
  A project directory ending in a backslash — `C:\Users\Tom&Jerry\my proj (v2)\` — produces `..."C:\Users\Tom&Jerry\my proj (v2)\"`, where the trailing backslash escapes its own closing quote. Argument parsing corrupts from that point on, and the command can still exit 0, so `ndx init` reports "registered" having stored a truncated command. All six now use `execFileSyncCli` from `win-spawn.js`, which applies the `quoteWindowsToken`/ArgvQuote rules and logs each invocation itself.
  
  Verified against that exact path: the argv form emits `"...(v2)\\"` with the backslash doubled, keeps every `&` inside a quoted token, and round-trips 9 argv entries to 9 command-line tokens.
  
  The unquoted interpolations in the old strings (`${scope}`, `${name}`, `${descriptor.mcpCommand}`) were manifest-derived constants rather than user input, so this was a correctness bug on unusual-but-legal paths, not a user-input injection vector.
  
  **The guard that should have caught it is now scan-based.** `architecture-policy.test.js` walked a hardcoded 12-file `DEP0190_SCOPE`, so it only ratcheted over files someone remembered to enumerate — which is exactly how `claude-integration.js` and `export.js` kept hand-built command lines through an entire Windows-hardening epic. It now scans the whole production tree for:
  
  - imports of `exec`/`execSync` from `child_process` (the string-command APIs — `execFile`/`execFileSync`/`spawn` take argv and are fine)
  - `shell: process.platform`
  - `shell: true` with non-empty args
  
  Exemptions moved into a `SHELL_STRING_EXEMPT` map where each entry states its reason, with the previously-undocumented `ci.js` and `pr-check.js` pnpm cases now recorded explicitly and `export.js` naming the task that will retire it. Demonstrated red-then-green against a newly added unhardened file, with no edit to the guard required to catch it.
  
  `claude-integration.js` was also dropped from the `child_process` import allowlists in `architecture-policy.test.js` and `ci.js` — it no longer imports any `child_process` API, so the permission was removed rather than left permitted-but-unused.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop printing the child-lifecycle process-group warning on every Windows `ndx` invocation.
  
  `packages/core/cli.js` builds its child-process tracker with `processGroups: true` at module load, and `createChildProcessTracker` emitted the fallback notice at construction time. Because `PLATFORM_SUPPORTS_PROCESS_GROUPS` is always `false` on win32, every command — including `ndx --version`, `ndx --help`, and `ndx status`, none of which spawn a child — prefixed its output with:
  
  ```
  [child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill
  ```
  
  The message read as a degradation, but direct child kill is the intended Windows path — `cli.js` already omits `detached: true` on win32 by design, so there was nothing for users to act on.
  
  The notice is now opt-in behind `NDX_DEBUG_LIFECYCLE` (or the global `NDX_DEBUG`), matching the existing `NDX_DEBUG_LLM` / `NDX_DEBUG` convention in `@n-dx/llm-client`. Set either to `1`, `true`, or `yes` to restore it when diagnosing child-cleanup behavior. Termination behavior is unchanged on all platforms; only the logging is gated. The `stripKnownRuntimeNoise` filter in `scripts/cli-smoke-parity.mjs` is retained so smoke output stays comparable against older installs and debug-enabled runs.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Register MCP servers using the discovered claude CLI path instead of a bare `claude` literal. `registerMcpServers` computed `claudeCmd = discovery.path` but the `claude mcp remove` / `claude mcp add` commands still shelled out to the literal string `claude`, requiring it on `PATH`. When `discoverClaudeCli` resolved claude at a well-known location that is not on `PATH` — notably Windows `%APPDATA%\npm\claude.cmd` / `claude.exe`, but also nvm and Homebrew installs — `ndx init` silently failed to register the rex and sourcevision MCP servers even though discovery had succeeded. Both commands now invoke the quoted discovered path, so MCP registration works on installs where claude is not on `PATH`.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Route `ndx start`'s port-occupant kill through the Windows-safe spawn helper.
  
  `killPortOccupant()` in `packages/core/web.js` arrived with the local-LLM-provider merge and built four command strings by hand:
  
  ```js
  execSync(`netstat -ano`, …)
  execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" })
  execSync(`lsof -ti tcp:${port}`, …)
  execSync(`kill -9 ${pid}`, { stdio: "ignore" })
  ```
  
  Unlike the earlier `claude-integration.js` and `export.js` conversions, there is no live defect here: `port` is `parseInt(flags.port, 10)` or a `typeof number`-validated config value, and both `pid` values are `parseInt` results, so no interpolation can carry `&`, `^`, `(`, `)`, `!`, or a trailing backslash into a shell command line. This is the blanket `exec`/`execSync` policy being applied to new code rather than a bug being fixed — the point of a scan-based guard is that new files do not get to opt out on the argument that their particular interpolations happen to be safe today.
  
  `netstat`, `taskkill`, and `lsof` now go through `execFileSyncCli` from `win-spawn.js` with argv. The POSIX kill drops its subprocess entirely in favour of `process.kill(pid, "SIGKILL")` — spawning `/bin/kill` to deliver a signal to a pid already in hand added a dependency on the binary being present for nothing. Failure behaviour is unchanged: `execFileSyncCli` throws on a non-zero exit exactly as `execSync` did (`lsof -ti` exits 1 when nothing is listening), and the whole body is already wrapped in a `try`/`catch` that returns `false`.
  
  Caught by `architecture-policy.test.js`'s scan-based shell-string guard as a semantic merge conflict — the two sides never touched the same lines, so the merge produced a tree that typechecked and passed every package test suite while violating a policy one of the branches had just added. Verified red-then-green against the guard (`packages/core/web.js — imports \`execSync\` from child_process` → 56/56 passing), with the full root suite green at 97 files.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix a POSIX process-group leak where surviving grandchildren were never force-killed.
  
  `terminateProcessGroup` sent SIGTERM to the child's process group, then decided whether to escalate to SIGKILL by checking the **direct child**:
  
  ```js
  await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
  if (!isChildRunning(child)) return;            // gates on the child
  try { killGroup(-child.pid, "SIGKILL"); }      // escalation for the group
  ```
  
  The leader commonly installs a SIGTERM handler and exits promptly while a grandchild ignores the signal — routine for long-running CLIs, including the claude/codex processes `ndx` spawns. The child's exit resolved the wait, the early return fired, and SIGKILL never reached the group, stranding every surviving member. That is the precise leak process groups exist to prevent.
  
  Escalation now depends on the group: `groupHasMembers()` probes with signal 0 (a kernel existence check that delivers nothing) and `waitForGroupExit()` polls it on a bounded deadline instead of awaiting the child's `exit` event, so all members get the grace period and SIGKILL lands whenever anyone is left.
  
  This is POSIX signal semantics, so it affected **macOS as well as Linux**.
  
  PID-reuse safety is documented at the probe: a pgid stays allocated while its group has members, and a pgid is its leader's PID, so that PID cannot be recycled while anyone remains in the group — probing immediately before signalling cannot target an unrelated process. If the group drains in between, the signal fails ESRCH and is swallowed.
  
  The Windows `taskkill /T /F` path is unchanged.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Terminate the whole process tree on Windows, behind one cross-OS contract.
  
  `child-lifecycle.js` previously exported `PLATFORM_SUPPORTS_PROCESS_GROUPS` and picked its termination strategy from it, so Windows silently got **direct child kill only** — any grandchild spawned by a tracked child was orphaned. Since `ndx` spawns CLIs that themselves spawn processes (claude/codex), that leak was real rather than theoretical.
  
  A single `terminateTree(child, options)` now owns the decision: POSIX signals the process group (`process.kill(-pgid)`, SIGTERM then SIGKILL); Windows runs `taskkill /PID <pid> /T /F` through `win-spawn.js`. Both fall back to killing the direct child if the tree-wide attempt fails or leaves it running. `PLATFORM_SUPPORTS_PROCESS_GROUPS` is no longer exported, and the `processGroups` tracker option is renamed `treeKill` — it named a POSIX mechanism that does not exist on Windows, where tree-killing nonetheless works.
  
  `cli.js` no longer branches on `process.platform` for termination: the `detached: true` decision moved into an exported `treeKillSpawnOptions()`, so the platform difference lives in the termination layer that owns it.
  
  Also removes the construction-time stderr notice entirely. Gating it behind `NDX_DEBUG_LIFECYCLE` (previous release) stopped it appearing on every command, but its text — "falling back to direct child kill" — is now simply false on Windows. Strategy reporting moved to `terminateTree`, where it names the strategy at the moment one actually runs.
  
  Documented Windows limitations, rather than papered over:
  
  - **No graceful phase.** `taskkill /T` without `/F` posts WM_CLOSE, which only a process pumping a window-message loop acts on — Node children do not — and `process.kill(pid, "SIGTERM")` is `TerminateProcess` anyway. A graceful pass would burn the grace period for nothing, so Windows goes straight to `/F`.
  - **Job Objects not used.** They are the architecturally correct primitive (kill-on-job-close is exactly analogous to a process group) but need a native addon, which would put a compiled dependency in a pure-JS orchestration package.
  - **Shutdown-time dependency.** taskkill is spawned during cleanup; if the `ndx` process is itself force-killed, no handler runs and the tree survives unless the host contained it.
  
  The `platform`, `spawnCliImpl`, and `killGroup` seams are injectable so **both** OS strategies are testable on any host — CI runs the suite on Linux only, so without them the Windows branch would ship unexercised.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Actually restrict API-key file permissions on Windows, instead of only claiming to.
  
  `config.js` called `chmod(path, 0o600)` after writing `.n-dx.json` whenever it held a provider API key, and `ndx config --help` stated "File permissions set to 0600 (owner-only) for security" unconditionally. On Windows both were false. Measured on Windows 11:
  
  ```
  after chmod(path, 0o600):
    mode reads back as 0666        (not 0600)
    icacls:  SYSTEM:(I)(F)  BUILTIN\Administrators:(I)(F)  <user>:(I)(F)
  ```
  
  Every entry is `(I)` — inherited. `fs.chmod` cannot express a POSIX mode on Windows; it maps only the read-only attribute and never touches the DACL. So the API key stayed readable by SYSTEM and every administrator while the help text promised owner-only, and the two tests that would have caught it were `it.skipIf(win32)`.
  
  A new `file-permissions.js` module now **attempts and then verifies** the restriction, reporting what it actually achieved:
  
  - **POSIX** — `chmod` to 0600, then confirm via `stat` that the mode landed (FAT/exFAT mounts and some network shares silently drop mode changes).
  - **Windows** — `icacls <path> /inheritance:r /grant:r <DOMAIN\user>:F` through `win-spawn.js`, then read the DACL back and require no inherited `(I)` entries and no principal other than the current user. The exit code is not trusted: icacls reports "Successfully processed 1 files" in cases where the resulting ACL is not what was requested.
  
  When verification fails, the user is warned at the point of writing — naming the file, the cause, and the safer alternative (`ANTHROPIC_API_KEY`, or Credential Manager on Windows). A false assurance about an API key is worse than a stated limitation. The help text now describes what the running platform actually does.
  
  Verified end-to-end: a real `ndx config claude.api_key` on Windows now produces a file whose ACL is exactly `<user>:(F)`.
  
  Also resolves the related `cli_path` executable check. `access(value, X_OK)` **succeeds for a plain JSON file** on Windows — Node documents X_OK as having no effect there, so it degrades to `F_OK` and the check could never reject anything, while advising "Run: chmod +x". It is now explicitly skipped on Windows via `executableBitIsMeaningful()` with the reasoning recorded. Requiring a PATHEXT extension instead was rejected: it would refuse the extensionless POSIX scripts that pnpm/npm global installs place beside their `.CMD` shims, and a validation that rejects valid input is worse than none — spawn-time diagnostics already cover the rest.
  
  All four Windows skips in `tests/e2e/cli-config.test.js` are gone (143 passing, 0 skipped): the permission assertions now check mode on POSIX and the DACL on Windows, and the executable-bit case asserts the documented Windows behaviour rather than being silently skipped.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Make a command timeout actually stop the command, descendants included.
  
  `exec` delegated its timeout to Node's `execFile`, which signals only the process it spawned. Anything that process had itself started survived — kept running, kept holding file handles, kept writing to the workspace — while the caller had already been told the command stopped. Measured on Windows with a 400ms timeout: the reported result was `Command timed out after 400ms`, yet the surviving process went on to write four more times, and a temp directory it held could not be removed for 52 seconds.
  
  That report is what an autonomous agent acts on. It reads files and runs the next command believing the previous one finished, so a build or codemod still writing underneath it can corrupt the state being read.
  
  `exec` now owns the timeout timer and terminates the whole process tree when it fires: a process-group signal on POSIX (`SIGTERM`, escalating to `SIGKILL`, waiting on the *group* rather than the direct child), and `taskkill /T /F` on Windows. `exitCode: null` still signals a timeout, and an externally-killed child still reports the same way it always did. Opt out with `treeKill: false` when a child must stay in the caller's own process group.
  
  Not a Windows-only fix, though Windows is where it was caught: the orphan survived on POSIX too, just invisibly, because unlinking open files is permitted there so no EBUSY drew attention to it. On Windows, libuv's global job object masks the problem for node-spawned node, but not for the cases that matter — `sh`, `cmd`, `make`, and pnpm/npm shims all leave their children behind.
  
  The primitive is exported as `terminateProcessTree` / `treeKillSpawnOptions`. It is a deliberate twin of `terminateTree` in `packages/core/child-lifecycle.js`, since the orchestration tier must not import from packages; a parity test fails if the two diverge.

- [#309](https://github.com/en-dash-consulting/n-dx/pull/309) [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Complete the `.gitattributes` LF-pin coverage (follow-up to [#283](https://github.com/en-dash-consulting/n-dx/issues/283)/[#285](https://github.com/en-dash-consulting/n-dx/issues/285)). Three n-dx-written surfaces were writing LF but had no eol pin, so Windows checkouts (`core.autocrlf=true`) showed line-ending-only churn on every tool write:
  
  - `.claude/skills/**/*.md` — generated Claude skills (now committed per [#284](https://github.com/en-dash-consulting/n-dx/issues/284))
  - `.codex/config.toml` — generated Codex MCP config
  - `.sourcevision/**/*.txt` — sourcevision text output (e.g. `llms.txt`)
  
  All three are added to both `GITATTRIBUTES_EOL_RULES` (the list `ndx init` injects into a project's `.gitattributes`) and n-dx's own `.gitattributes`, keeping the two in sync per the stated invariant.
  
  The root cause of the pins shipping incomplete was that these two sources drifted apart — one updated, the other not — and no test caught it. To close that class of bug for good:
  
  - The rules are extracted into a single importable source of truth (`packages/core/gitattributes-pins.js`), imported by `cli.js`.
  - A **sync-guard test** (`prd-line-endings.test.js`) asserts the injector's pattern set equals n-dx's own `.gitattributes` `eol=lf` pattern set — any future divergence fails CI, not just the three patterns fixed today. `cli-init.test.js` also asserts the new patterns are injected.

- [#285](https://github.com/en-dash-consulting/n-dx/pull/285) [`437c27a`](https://github.com/en-dash-consulting/n-dx/commit/437c27a7645e2db0ab6b666384e1f210cc4ff21f) Thanks [@stevemikedan](https://github.com/stevemikedan)! - `ndx init` now writes (or merges into) the target project's `.gitattributes`, pinning every n-dx-written tracked file (`.rex/`, `.hench/`, `.sourcevision/`, `.n-dx.json`, `AGENTS.md`, `CLAUDE.md`, `.agents/`) to `text eol=lf`. This stops Windows checkouts (`core.autocrlf=true`) from showing spurious line-ending-only modifications after every tool write. Existing `.gitattributes` content is preserved and user rules for overlapping patterns win; re-running `ndx init` is idempotent.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Make the hench pre-run commit gate size-aware with configurable thresholds.
  
  The gate now measures change magnitude (dirty file count plus lines changed vs HEAD via `git diff --numstat`, shared helper `measureChangeMagnitude`) instead of reacting only to a non-empty dirty list. Two new persisted settings under `hench.git.*` (`.hench/config.json`, editable via `ndx config`):
  
  - **`hench.git.checkpointThreshold`** (default: 200, 0 disables) — at/above this many changed lines, the interactive prompt warns about the change size and defaults to committing a checkpoint instead of proceeding. Below the threshold, behavior is unchanged.
  - **`hench.git.requireCleanTree`** (default: false) — refuse to start against a dirty tree: the interactive prompt drops the "proceed" option and non-interactive runs (`--yes`, piped) abort.
  
  Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) keep today's behavior — abort on any dirty tree unless `--allow-dirty` — but the refusal now reports the measured magnitude. `--allow-dirty` takes precedence over both config settings for a single run (flag > config > defaults). Documented in `hench run --help` and `ndx config --help`.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Clear the losing timer in every bounded termination wait, so a CLI exits when its work is done.
  
  `Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)])` reads as "wait, but not forever". It also leaks: when the child wins the race, the `delay` timer is still armed, and an armed timer holds the event loop open. Nothing was waiting on it — the process simply could not exit until it fired.
  
  Measured against `sh -c "sleep 30"` with a 300 ms command timeout, before and after, no other change:
  
  | | `exec()` resolves | process exits | dead time |
  |---|---|---|---|
  | before | 432 ms | 5436 ms | ~5000 ms |
  | after | 445 ms | 446 ms | ~1 ms |
  
  The 5 s is `DEFAULT_FORCE_KILL_TIMEOUT_MS`. Any CLI that finished immediately after a command timeout sat idle for the full kill grace period before returning to the shell.
  
  Nine sites across the two twins, all of them replaced with a `raceWithTimeout` helper that clears its own timer in a `finally`:
  
  - `packages/llm-client/src/process-tree.ts` — four `waitForChildExit` races, the `taskkill` completion race, and `captureStdout`'s bare `setTimeout(finish, timeoutMs)`. That last one is the worst of the set: it is reached on every POSIX non-freeze kill via `posixDescendants` → `readProcessTable`, where `ps` returns in milliseconds but the timer is armed for the whole grace period.
  - `packages/core/child-lifecycle.js` — the `childTarget` wait adapter and both Windows tree-kill races. Same defect, and it had to be fixed twice because the orchestration tier cannot import `@n-dx/llm-client` (spawn-only rule).
  
  The polling `delay()` calls are deliberately untouched. Those are awaited directly rather than raced, so their timer always fires and never outlives its await — replacing them would add a `clearTimeout` that can never run.
  
  No behavioural change to the kill sequence itself: the same signals go out in the same order with the same bounds, and every existing termination test passes unmodified. What changes is only how long the process lingers afterwards.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a dashboard "Refresh Data" trigger: new `ndx refresh --live-server` mode skips the pre-refresh server termination and refuses UI-rebuild plans, and the web dashboard gains POST /api/commands/refresh (+ status poll) with a Refresh Data panel in the Commands view.

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Add `ndx auth` — on-demand credential verification for the active LLM vendor.
  
  The command re-runs the same provider auth preflight used by `ndx init` / `ndx config llm.vendor` and exits 0 when credentials are valid (printing the active vendor, resolved model, and "credentials valid") or 1 on failure (printing the canonical, JSON-free auth-failure guidance). It works without an initialized project — the default vendor (claude) is checked when no config exists.
  
  Every vendor's auth-failure remediation (and the flattened `authFailureMessage` used by runtime errors) now ends with the canonical verification step `Verify credentials: ndx auth`, exported from `@n-dx/llm-client` as `VERIFY_CREDENTIALS_STEP`, so users always know how to confirm a fix.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Dashboard command triggers (refresh, ci, auth, self-heal, export) now resolve the ndx CLI on analyzed projects that aren't the n-dx monorepo: cli.js advertises its own path to child processes via `N_DX_CLI_PATH`, and the server's resolver tries the project-local bin, that env path, and `@n-dx/core/cli.js` from its module graph before the monorepo dogfood fallback.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `ndx pair-programming` orphaning processes when a reviewer CLI or test command times out.
  
  All three timeout paths in `pair-programming.js` signalled only the direct child with a bare `child.kill("SIGTERM")`. That was four separate defects: no tree kill, so descendants survived; no process group to signal on POSIX; no escalation, so a child that ignores SIGTERM outlived its own timeout indefinitely; and `resolve()` on the line after `kill()`, so the caller saw `timedOut: true` while the tree was still running and still holding the workspace and any port it had bound.
  
  `runShellTestCommand` was the worst of the three and broken deterministically rather than by race: it spawns with `shell: true`, so the child being signalled *is* the shell and never the test command beneath it. A timed-out `npm test` kept building with its output pipe already abandoned.
  
  All three now terminate through `child-lifecycle.js`'s `terminateTree` — process group on POSIX, `taskkill /T` on Windows, escalating to SIGKILL — and **await** it before resolving, so `timedOut` cannot be observed while the tree is alive. Each spawn passes `treeKillSpawnOptions()` so the POSIX group-signal path has a group to signal.
  
  Detaching for that group had a catch worth naming: a detached child leaves this process's foreground group, so Ctrl-C would no longer have reached it — trading a timeout orphan for an interrupt orphan. `cli.js` now registers these children with the tracker whose SIGINT/SIGTERM/SIGHUP handlers already terminate tracked trees, via a new `registerChild` injection seam.
  
  Covered by real-process tests (`tests/e2e/pair-programming-timeout-tree-kill.test.js`) that assert the grandchild is dead *without polling* — the promise settling early is precisely the defect — and that a SIGTERM-ignoring command still dies.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a BETA option to make the POSIX timeout kill definitive: freeze the process tree, prove it is frozen, then kill it. **Off by default.**
  
  It ships behind a flag because the sweep it replaces has far more mileage: the freeze path's unit coverage injects its seams, and its behaviour against real POSIX processes is not yet proven in CI. Enable per-project with `ndx config experimental.posixFreezeTreeKill true`, or for a single run with `NDX_POSIX_FREEZE_KILL=1`. `ndx config --help` documents it as BETA and NOT RIGOROUSLY TESTED so nobody turns it on unaware.
  
  The previous approach enumerated descendants and signalled them, which is inference. Its hole is reparenting: a descendant whose parent dies is adopted by init, so the pid→ppid link the enumeration depends on dissolves at exactly the moment the killing starts. The old code collected descendants *before* signalling to work around that; freezing first removes it, because reparenting only happens when a parent exits and nothing exits until enumeration is finished.
  
  On timeout, `exec` now SIGSTOPs the tree, closes over its descendants to a fixpoint — a pass that discovers nothing, rather than a fixed number of rounds — verifies every member reads as stopped in the process table, and only then SIGKILLs, leaves before parents. It terminates because SIGSTOP cannot be caught, blocked, or ignored and a stopped process cannot fork, so new arrivals can only come from processes that were still running at the previous read, and that set shrinks monotonically. When the child *is* a process-group leader the fast path skips enumeration entirely: group membership is inherited rather than listed, so `SIGSTOP` then `SIGKILL` on the group are atomic over the whole tree.
  
  SIGKILL, never SIGTERM: a stopped process does not act on SIGTERM — the signal queues until SIGCONT — so a "graceful" attempt against a frozen tree is a silent no-op. Freezing and graceful termination are therefore mutually exclusive, and this policy is opt-in via `freeze` on `terminateProcessTree`, used only for timeouts and runaways. Graceful shutdown keeps its SIGTERM grace period unchanged, and a test pins that the two policies stay distinct.
  
  Windows is unchanged. It has no pure-JS pause — libuv maps the signals it supports onto TerminateProcess, and the real equivalents all need native code — so `taskkill /T` remains a tree walk. Its failure mode is the mirror image of POSIX's and is now documented where taskkill is invoked: Windows never reparents, so a link survives its parent's death and can dangle onto a recycled pid.
  
  Known limit, recorded in the code: a deliberate double-fork daemon escapes parentage by design and no enumeration finds it. That is a policy question about whether agent-run commands may daemonize, not a detection one.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Reconcile Codex model identifiers across the config surface. Removed the dead `gpt-5.4mini` legacy alias from `LEGACY_CODEX_MODEL_ALIASES` (its target `gpt-5.4-mini` is already a direct catalog model and the non-hyphen key was never a shipped ID). The remaining legacy brand IDs (`gpt-5-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`) now match the orchestration-tier list in `init-llm.js`, with cross-reference comments pinning the two tiers together. Updated the hench vendor-compatibility error hint from the outdated `gpt-4o, o1` to current Codex models (`gpt-5.5, gpt-5.4-mini`).

- [#279](https://github.com/en-dash-consulting/n-dx/pull/279) [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd) Thanks [@endash-shal](https://github.com/endash-shal)! - Refresh the Claude model catalog shown in `ndx init` and align the runtime default. Adds **Claude Fable 5** (`claude-fable-5`) and **Claude Sonnet 5** (`claude-sonnet-5`) to the selector, and promotes Sonnet 5 to the recommended default (replacing the previous-generation Sonnet 4.6 as the pre-selected model and as `DEFAULT_CLAUDE_MODEL` / `NEWEST_MODELS.claude`). Sonnet 5's 1M context window and pricing are registered for budget preflight. `claude-sonnet-4-6` remains a valid, accepted model id (kept in the context/cost maps and added to the init legacy-alias list) so existing configs and `--claude-model=claude-sonnet-4-6` keep working without warnings. Codex and Gemini catalogs are unchanged.

- [#324](https://github.com/en-dash-consulting/n-dx/pull/324) [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1) Thanks [@en-drza](https://github.com/en-drza)! - Add sample app installation feature with dashboard tutorial and optimize CLI resolution path

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Self-heal and n-dx workflow visibility in the dashboard. The dashboard can now run and observe the full n-dx flow: self-heal with live iteration/phase progress and a stop control, full sourcevision analysis with async progress, rex fix/reshape/CI actions with dry-run previews, a Commands reference with inline run triggers, and views for the previously UI-less requirements, adaptive-optimization, and activity-log APIs. Command references throughout the dashboard and hench prompts resolve from the project's detected CLI name.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - `ndx start stop` now terminates the background server's children, not just the recorded PID.
  
  The stop path signalled only the PID from `.n-dx-web.pid`. On Windows that is doubly insufficient: SIGTERM is `TerminateProcess`, so the server never ran its cleanup handlers, and nothing walked the tree — so any `rex analyze` or `hench run` the server had spawned survived, potentially holding the port or the workspace. The server is also started `detached: true`, which places it outside libuv's job object, so nothing else would have reaped those children either.
  
  Stop now routes through a shared `terminateTreeByPid` in `child-lifecycle.js`: `taskkill /T` on Windows, a process-group signal on POSIX. Grace periods are unchanged — `ndx start stop` keeps its 2s default and the `N_DX_STOP_GRACE_MS` override, deliberately shorter than the 5s used for shutdown, so consolidating the mechanism does not change stop latency.
  
  There were three copies of the SIGTERM → grace → SIGKILL escalation (`child-lifecycle.js`, `web.js`, `cli.js`); there is now one, written against injected signal/liveness/wait capabilities so a live `ChildProcess`, a bare PID, and a POSIX process group all share the same sequence instead of each drifting. A PID is weaker evidence than a handle — `kill(pid, 0)` cannot distinguish a live process from a zombie or a recycled PID — so pid-file staleness handling stays with the callers that own the file rather than being assumed away.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - The "Update available" notice now suggests an upgrade command that actually works.
  
  Previously it always printed `npm i -g @n-dx/core`, regardless of how the copy was installed, which failed two ways:
  
  - **Wrong package manager.** A pnpm-global user following `npm i -g` ends up with a second global install under the npm prefix. Both ship an `ndx` shim, and whichever resolves first on `PATH` wins — so `ndx --version` can keep reporting the old version even though the upgrade "succeeded". `update-check.js` now infers the installing manager from its own path on disk (pnpm's `.pnpm` virtual store, yarn's data directory, else npm) and prints the matching `pnpm add -g` / `yarn global add` / `npm i -g` form.
  - **Missing `@latest`.** pnpm records a caret range in its global manifest, and for 0.x versions `^0.3.1` means `>=0.3.1 <0.4.0`. A bare `pnpm add -g @n-dx/core` or `pnpm update -g` re-resolves inside that range and can never cross a minor boundary, leaving users stranded on an old line indefinitely. The suggested command now always pins `@n-dx/core@latest`.
  
  Adds a `docs/guide/troubleshooting.md` entry for the `ERR_MODULE_NOT_FOUND … assistant-assets/index.js` crash that 0.3.x installs hit, since that failure occurs while Node links the module graph — before any `ndx` code can run and surface an update notice. Documents the upgrade-pinning rule in the README install section.

- [#329](https://github.com/en-dash-consulting/n-dx/pull/329) [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff) Thanks [@endash-shal](https://github.com/endash-shal)! - Record every vendor CLI invocation to an append-only `claude_commands.log`.
  
  Each `claude` / `codex` spawn now appends one JSON line capturing the timestamp, vendor, binary, argv, cwd, platform, the spawning helper, and — on Windows — the fully-built verbatim command line. The log accumulates across sessions, giving a project a consistent history of what was actually run.
  
  Wired at the spawn chokepoints rather than per call site, so a single edit per tier covers everything downstream:
  
  - `packages/llm-client/src/exec.ts` `spawnCli` — covers `cli-provider.ts` (claude), `codex-cli-provider.ts` (codex), and hench's `cli-loop.ts`
  - `packages/core/win-spawn.js` `spawnCli` + `execFileSyncCli` — covers `pair-programming.js` reviewer runs and `config.js` preflight/`--version` probes
  - `packages/core/claude-integration.js` — the `ndx init` MCP registration `claude mcp add/remove` calls, which use raw `execSync` and bypass the helpers
  
  Behaviour:
  
  - **On by default**; opt out with `NDX_CLI_LOG=0` (also `false` / `no`).
  - **Path**: `<cwd>/claude_commands.log`, overridable via `NDX_CLI_LOG_PATH`. Gitignored, along with its rotated `.1` generation.
  - **Secrets redacted before the write** — values following `--api-key`/`--token`/`--password` (and the `--flag=value` form), plus standalone `sk-ant-*`, `sk-*`, `gh[pousr]_*`, and `AIza*` tokens become `<redacted>`. The log is a plain file that outlives the process, so redaction happens at write time rather than read time.
  - **One atomic single-line append per invocation**, so concurrent `ndx` processes interleave cleanly by line instead of tearing.
  - **Never throws** — an unwritable cwd, permission error, or full disk cannot turn a logging failure into a spawn failure.
  - **Rotates at 1 MB** to `claude_commands.log.1`, mirroring `.rex/execution-log.jsonl`.
  
  The implementation is duplicated as `packages/llm-client/src/cli-log.ts` and `packages/core/cli-log.js` because the orchestration tier must not import `@n-dx/llm-client` (spawn-only rule) — the same constraint that already forces the `quoteWindowsToken` twin. `tests/unit/cli-log.test.js` runs the full behavioural suite against both copies and asserts they emit byte-identical lines for a shared record table; both twins are imported from source so the parity check cannot fail on a stale `dist/`.
  
  Also adds `cli-log.js` to `@n-dx/core`'s `files` allowlist — without it the published package would import a file it does not ship.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop quoting bare command names in the Windows cmd.exe verbatim command line so PATHEXT resolution still applies. `buildWindowsCliCommandLine` quoted every token including the binary, and a quoted command name makes cmd.exe look for an exact filename match on PATH instead of trying `.CMD`/`.EXE`/… in turn. When a PATH directory holds an extensionless file beside its shim — exactly what pnpm/npm global installs produce (`pnpm` + `pnpm.CMD`, `claude` + `claude.CMD`) — cmd found the extensionless POSIX script, failed `CreateProcess`, and exited 1 with `The system cannot find the path specified.`, making the CLI look absent on Windows. Arguments are still quoted unconditionally and binary paths containing spaces or metacharacters keep their quotes, so the GH [#68](https://github.com/en-dash-consulting/n-dx/issues/68) spaced-path handling is unchanged. Non-Windows platforms are unaffected — they use a plain `spawn` and never build a cmd.exe command line.

- [#299](https://github.com/en-dash-consulting/n-dx/pull/299) [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Harden CLI spawning on Windows so launching `.cmd` shims (claude, codex, rex) no longer fails. Node can't spawn a `.cmd` directly (post-CVE-2024-27980), and the previous `shell: process.platform === "win32"` workaround triggered the `[DEP0190]` deprecation and broke on paths containing spaces.
  
  - **New `spawnCli` helper** (`@n-dx/llm-client`) routes CLI binaries through `cmd.exe /d /s /c` with `windowsVerbatimArguments` and never uses `shell:true`. Argument quoting follows the Microsoft ArgvQuote / cross-spawn rules (unconditional quoting, backslash-run doubling before quotes, embedded-quote doubling) so paths with spaces and tokens with cmd.exe metacharacters (`& | < > ^ ( )`) are handled. The orchestration tier (`@n-dx/core`) carries an equivalent `win-spawn.js` twin (it cannot import `@n-dx/llm-client`), kept in lockstep by a cross-package parity test.
  - **All CLI-binary spawn sites** are routed through the helper: the claude and codex providers, the hench agent loop and its adapters, the `ndx config` CLI-path validator, `ndx pair-programming`'s reviewer, and sourcevision's `rex` invocations.
  - **Prompts are delivered via stdin** for the codex hench adapter and the pair-programming reviewer (previously passed as an argv token), preventing multi-line prompt truncation and command injection through `cmd.exe`.
  - **`diagnoseCliInvocation`** produces an actionable message when a CLI binary is missing or not invokable — distinguishing a not-found binary, a configured absolute path that doesn't exist, and a binary present on PATH but failing to run — and works from the close/non-zero-exit path on Windows (where a missing `.cmd` never raises `ENOENT`). Detection is anchored to the spawned binary so a legitimate run's own error output isn't misclassified.
  - A **regression guard test** fails CI if any CLI spawn site reintroduces the `shell:true` + args (`DEP0190`) pattern.
  
  No behavior change on macOS or Linux.
- Updated dependencies [[`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`56a63ea`](https://github.com/en-dash-consulting/n-dx/commit/56a63ea6ef7911166578df2d5bab88e5d6c89d04), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`e35c1c1`](https://github.com/en-dash-consulting/n-dx/commit/e35c1c1f86ed2a831b039acc906b3431d5c1d3e1), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`231c72f`](https://github.com/en-dash-consulting/n-dx/commit/231c72f38b17d329a2eabdba9940fb0e9799b949), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92)]:
  - @n-dx/web@0.5.0
  - @n-dx/llm-client@0.5.0
  - @n-dx/rex@0.5.0
  - @n-dx/hench@0.5.0
  - @n-dx/sourcevision@0.5.0

## 0.4.6

### Patch Changes

- [#268](https://github.com/en-dash-consulting/n-dx/pull/268) [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Fix `ndx plan --no-llm` not suppressing LLM calls in sourcevision zone enrichment. The flag was filtered out before being passed to `sourcevision analyze`; now maps to `--fast` (skip AI enrichment) so the full pipeline respects the flag.

- [#267](https://github.com/en-dash-consulting/n-dx/pull/267) [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Fix `ndx ci` on Windows: pnpm is a `.cmd` shim and requires `shell: true` to resolve without ENOENT. Add `shell: process.platform === "win32"` to the docs-build spawn in `ci.js`.

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Record `/ndx-work` task execution in hench run history ([#271](https://github.com/en-dash-consulting/n-dx/issues/271)). The `/ndx-work` skill drove tasks through Claude Code without spawning hench, so the work left no `.hench/runs/` entry and was invisible to run history and `ndx usage`. A new `hench record` command writes a lightweight run record (task id, title, status, summary, timestamps, model) marked `assisted`, and the skill now calls it as a final step. Because Claude Code does not expose its own token consumption to a running skill, assisted records carry empty token usage and an `assisted` flag so analytics can distinguish them from genuine hench runs rather than reading them as anomalies; the skill also surfaces this caveat to the user.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2), [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99)]:
  - @n-dx/sourcevision@0.4.6
  - @n-dx/llm-client@0.4.6
  - @n-dx/rex@0.4.6
  - @n-dx/web@0.4.6
  - @n-dx/hench@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- [#236](https://github.com/en-dash-consulting/n-dx/pull/236) [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b) Thanks [@endash-shal](https://github.com/endash-shal)! - init changes to readmes, and startup messages

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`7dc2319`](https://github.com/en-dash-consulting/n-dx/commit/7dc231981c78861a0ab5b3e4cefee1e940d474ea), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/sourcevision@0.4.5
  - @n-dx/llm-client@0.4.5
  - @n-dx/hench@0.4.5
  - @n-dx/rex@0.4.5
  - @n-dx/web@0.4.5

## 0.4.4

### Patch Changes

- [#233](https://github.com/en-dash-consulting/n-dx/pull/233) [`a31403d`](https://github.com/en-dash-consulting/n-dx/commit/a31403d8438cfea90f87abff1caf70f92d07e64c) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix: include `self-heal-confirm.js` in the published `@n-dx/core` tarball.
  The file exists in source and is imported by `cli.js` (line 50), but was
  missing from `package.json`'s `files` array, so 0.4.3 published without
  it and `ndx` crashed at startup with
  `ERR_MODULE_NOT_FOUND: Cannot find module … self-heal-confirm.js`.

  Because the changeset config groups all six `@n-dx/*` packages as
  `fixed`, this patch bumps the whole set to 0.4.4 — the other five
  packages republish unchanged but at the new version.

- Updated dependencies []:
  - @n-dx/rex@0.4.4
  - @n-dx/hench@0.4.4
  - @n-dx/sourcevision@0.4.4
  - @n-dx/llm-client@0.4.4
  - @n-dx/web@0.4.4

## 0.4.3

### Patch Changes

- [#229](https://github.com/en-dash-consulting/n-dx/pull/229) [`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0) Thanks [@dnaniel](https://github.com/dnaniel)! - Republish via npm Trusted Publishing. 0.4.2 was bumped in source but never
  made it to the registry because the original NPM_TOKEN-based publish in
  the Release run for [#227](https://github.com/en-dash-consulting/n-dx/issues/227) returned E404. Workflow now uses OIDC; this
  changeset moves all six packages to 0.4.3 so they get published with
  provenance attestation.
- Updated dependencies [[`2a754b2`](https://github.com/en-dash-consulting/n-dx/commit/2a754b21efed8738ce798eb1cc231d34e668efa0)]:
  - @n-dx/hench@0.4.3
  - @n-dx/llm-client@0.4.3
  - @n-dx/rex@0.4.3
  - @n-dx/sourcevision@0.4.3
  - @n-dx/web@0.4.3

## 0.4.2

### Patch Changes

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

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d278f05`](https://github.com/en-dash-consulting/n-dx/commit/d278f0506c94ae8bce068f770caa450e07a3330e), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`d85139f`](https://github.com/en-dash-consulting/n-dx/commit/d85139fab48b4ad66d5b6b1619243b505b96f0fc), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`f966861`](https://github.com/en-dash-consulting/n-dx/commit/f9668613ebf031ebb1417903157ab5dc277b16a0), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/web@0.4.2
  - @n-dx/llm-client@0.4.2
  - @n-dx/hench@0.4.2
  - @n-dx/rex@0.4.2
  - @n-dx/sourcevision@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1
  - @n-dx/hench@0.4.1
  - @n-dx/rex@0.4.1
  - @n-dx/web@0.4.1
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
  - @n-dx/hench@0.4.0
  - @n-dx/rex@0.4.0
  - @n-dx/web@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/sourcevision@0.3.4
  - @n-dx/llm-client@0.3.4
  - @n-dx/hench@0.3.4
  - @n-dx/rex@0.3.4
  - @n-dx/web@0.3.4

## 0.3.3

### Patch Changes

- [#194](https://github.com/en-dash-consulting/n-dx/pull/194) [`e1dbec6`](https://github.com/en-dash-consulting/n-dx/commit/e1dbec68bd350dc15293fbf473b0c285a09c4f04) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix `ndx` crashing on launch with `ERR_MODULE_NOT_FOUND: ./pair-programming.js`. The file is now included in the published `@n-dx/core` package's `files` array; previously `cli.js` imported a file that was excluded from the tarball.

  Docs: add an **Existing project onboarding** guide for adopting ndx into a repo with real history, expand the **Quickstart** with screenshots of `ndx init` / `analyze` / `plan` / `status` / `work`, and add a `@n-dx/core` package README so the npm landing page is no longer empty.

- Updated dependencies [[`700f356`](https://github.com/en-dash-consulting/n-dx/commit/700f356b146864e2aacafd9f0cace42a7942add8)]:
  - @n-dx/web@0.3.3
  - @n-dx/rex@0.3.3
  - @n-dx/hench@0.3.3
  - @n-dx/sourcevision@0.3.3
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies [[`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd), [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363), [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48)]:
  - @n-dx/hench@0.3.2
  - @n-dx/rex@0.3.2
  - @n-dx/web@0.3.2
  - @n-dx/sourcevision@0.3.2
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- [#172](https://github.com/en-dash-consulting/n-dx/pull/172) [`c1e1f5f`](https://github.com/en-dash-consulting/n-dx/commit/c1e1f5f19acba2990c63c3ffc6cb8016d52c233b) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `ndx` binary crashing on npm install due to missing files in the published tarball

  - `packages/core/package.json` `files` array was missing `assistant-integration.js` and `codex-integration.js`
  - `cli.js` statically imports `assistant-integration.js`, which in turn statically imports `codex-integration.js`, so the resolution failure happened at module load before any error handling could run
  - Verified via `npm pack --dry-run`: tarball now ships 25 files, and the transitive static-import graph from `cli.js` resolves cleanly

- Updated dependencies []:
  - @n-dx/rex@0.3.1
  - @n-dx/hench@0.3.1
  - @n-dx/sourcevision@0.3.1
  - @n-dx/llm-client@0.3.1
  - @n-dx/web@0.3.1

## 0.3.0

### Minor Changes

- [#158](https://github.com/en-dash-consulting/n-dx/pull/158) [`29a1fb0`](https://github.com/en-dash-consulting/n-dx/commit/29a1fb0185570191173a08dec78476e7a43ad10f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Vendor-neutral assistant integration layer for ndx init

  - Add assistant-integration orchestration that provisions Claude and Codex surfaces independently of the active LLM vendor
  - Add init-llm module with interactive provider/model selection via enquirer (flag > config > prompt precedence)
  - Add vendor-specific model flags (--claude-model, --codex-model) that persist independently
  - Fix MCP server re-registration: remove before re-add so ndx init is idempotent
  - Surface MCP registration error details in init summary instead of silent failures
  - Integrate child-lifecycle process tracking and signal handlers from main
  - Add machine-local config support (.n-dx.local.json) for CLI paths and other per-machine settings

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#164](https://github.com/en-dash-consulting/n-dx/pull/164) [`b9d59f2`](https://github.com/en-dash-consulting/n-dx/commit/b9d59f2da1653066a53068ef3f244f443c5ea615) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `cli.timeouts.<command>` being silently ignored when stored as a string

  - `ndx config cli.timeouts.work <ms>` now stores the value as a number (numeric-shaped strings and `"true"`/`"false"` are auto-coerced when setting a brand-new key)
  - `resolveCommandTimeout` accepts numeric strings defensively, so existing configs that were written as strings by earlier versions start working without a re-set
  - `ndx init` runs a new config-repair pass that rewrites known-numeric paths (`cli.timeoutMs`, `cli.timeouts.*`, `web.port`) as proper numbers and reports what was repaired

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/sourcevision@0.3.0
  - @n-dx/llm-client@0.3.0
  - @n-dx/hench@0.3.0
  - @n-dx/rex@0.3.0
  - @n-dx/web@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/sourcevision@0.2.3
  - @n-dx/llm-client@0.2.3
  - @n-dx/hench@0.2.3
  - @n-dx/rex@0.2.3
  - @n-dx/web@0.2.3

## 0.2.2

### Patch Changes

- [#153](https://github.com/en-dash-consulting/n-dx/pull/153) [`b99f8a7`](https://github.com/en-dash-consulting/n-dx/commit/b99f8a7d2a0055fbed57acc04e8a2df21bfa92b7) Thanks [@dnaniel](https://github.com/dnaniel)! - Immersive animated init experience with Ink TUI framework

  - Walking T-Rex mascot with shaded pixel art (half-block fg/bg color technique)
  - Ink-based animated UI with React components (htm/react for JSX without build step)
  - Braille spinners for each init phase, smooth animation via child process offloading
  - Sourcevision fast analysis (--fast) runs during init for immediate codebase data
  - Graceful degradation: static fallback for non-TTY, --quiet mode, NO_COLOR support
  - Actionable next-steps menu with CLI commands and skill suggestions
  - New dependencies: ink, react, htm

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/sourcevision@0.2.2
  - @n-dx/llm-client@0.2.2
  - @n-dx/rex@0.2.2
  - @n-dx/web@0.2.2
  - @n-dx/hench@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf)]:
  - @n-dx/hench@0.2.1
  - @n-dx/rex@0.2.1
  - @n-dx/web@0.2.1
  - @n-dx/sourcevision@0.2.1
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Minor Changes

- [#120](https://github.com/en-dash-consulting/n-dx/pull/120) [`e14ea38`](https://github.com/en-dash-consulting/n-dx/commit/e14ea3841297390ba2a7b1ee589e1e422425ec5e) Thanks [@dnaniel](https://github.com/dnaniel)! - Extract @n-dx/core into packages/core/ as a proper workspace package. Fixes workspace:\* dependency leak that prevented npm installation.

### Patch Changes

- Updated dependencies []:
  - @n-dx/rex@0.2.0
  - @n-dx/hench@0.2.0
  - @n-dx/sourcevision@0.2.0
  - @n-dx/llm-client@0.2.0
  - @n-dx/web@0.2.0
