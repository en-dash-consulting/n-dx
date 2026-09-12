# @n-dx/rex

## 0.6.0

### Patch Changes

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Insert an `analyze --accept` batch in one transaction, so it stops failing its own stale-save guard.
  
  Acceptance called `store.addItem` once per item, so accepting N items ran N
  transactions and serialized the whole folder tree N times. Every intermediate
  shape reached disk — and one of them is destructive to clean up. An epic
  inserted before its first feature has no children, so the serializer writes it
  as the leaf `general.md`; the transaction that adds that feature must then
  DELETE the leaf to promote the epic to `general/index.md`.
  
  The stale-save guard weighs every such deletion against the transaction's own
  load time, with a 2 ms tolerance. Measured on Windows, the leaf's mtime lands
  just 0.57–2.04 ms before the next transaction's load — inside the window, but
  with almost nothing to spare. Under the I/O pressure of the full monorepo suite
  the write timestamp drifts past it, and the accept aborts with
  
      Stale-save guard: this save would delete 1 item written after the document
      being saved was loaded
  
  naming `prd_tree/general.md` and warning that another writer's work was about to
  be destroyed. It was its own, one transaction earlier. This reproduced 2/2
  through `scripts/run-all-tests.mjs` and passed 2/2 with the rex suite alone,
  so it presented as flake rather than as a bug in the accept path — that runner's
  header already refers to "rex's load-sensitive tests".
  
  Proposals are now built into fully-nested epics up front and pushed in a single
  `store.withTransaction`, which is what the guard's own error message advises.
  One write emits the final shape, so the intermediate leaf is never created and
  there is no deletion to weigh. Verified with a filesystem watcher over a real
  accept: only `general/`, `general/index.md` and the feature file are touched.
  Item stamping (`withSelfHealTag` then `stampModified`) is preserved per item and
  now happens outside the lock, since resolving the actor can shell out to git.
  
  This is the write path the surrounding "move file lock to saveDocument" work
  missed — it converted `reorganize`, `prune` and `reshape`, but not
  `analyze --accept`. Accepted counts, batch-record output and the
  `analyze_accept` execution-log entry are unchanged.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Reject a PRD bundle whose dependency graph cycles or whose nesting is illegal.
  
  `parseBundle` held items to `validateDocument`, which is a field-shape check.
  Two whole-tree faults passed straight through it and into the tree:
  
  A `blockedBy` cycle imported cleanly and surfaced later as a wedged
  `get_next_task` and `report`, which walk dependencies expecting a DAG. And
  nesting was never checked at all, though every other insertion path enforces it
  — `insertChild`, `core/move.ts`, with `core/structural.ts` reporting existing
  violations. `--replace` installs the bundle's tree wholesale, so a feature at
  the root or a subtask under an epic was saved without complaint and reappeared
  as a `rex health` / `reorganize` placement violation.
  
  Both are now checked in `parseBundle`, before the store is opened: the rejection
  leaves the tree untouched by construction and does not consume a snapshot slot.
  The errors name the cycle, or both levels and the offending item's title.
  
  Merge mode gets one further check that `parseBundle` cannot make. Its graft
  lands bundle items under *local* parents, and a local reshape may have
  re-levelled a same-id item since the export, so placement is validated against
  the level of the parent the item actually arrives under — sharing one rule with
  the bundle-internal check rather than restating it.
  
  Only cycles are rejected from the dependency graph, not unresolved `blockedBy`
  references: a merge legitimately points at ids that live in the destination
  tree, and a scoped export already prunes the edges it cannot close. The cycle
  detection is now shared with `validateDAG` (`findDependencyCycles`) instead of
  duplicated, and `validateDAG`'s own output is unchanged.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Label a PRD bundle with the document's schema version, not the exporter's.
  
  `buildBundle` wrote `schema: SCHEMA_VERSION` — its own running constant.
  `isCompatibleSchema` deliberately admits newer minors and the document schema is
  a `.passthrough()`, so a document written by a future rex loads here intact,
  unrecognised fields and all. Exporting it relabelled it downward, and
  `parseBundle`'s gate then compared `0 > 0` and never fired: those fields reached
  the tree unvalidated, which is precisely what the gate exists to prevent.
  
  The bundle now carries `doc.schema`, falling back to the running version when
  the document has no marker — a bundle labelled `undefined` is one no version
  gate can read.
  
  Exposure was narrower than it looks, and remains so: the folder-tree load path
  hardcodes the running version and the tree persists no marker of its own, so
  only the legacy `prd.md` / `prd.json` backends preserve a file's schema string
  today. Closing that gap is tracked separately.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop PRD bundles carrying the source project's remote-sync pointers.
  
  `lastSyncedAt` and `remoteId` bind an item to the *source* project's remote.
  `sync.ts` already treats both as non-content, but nothing stripped them on the
  way into a bundle, so they travelled to the destination.
  
  Export from project A, synced to A's Notion workspace, then import into project
  B: the items arrived with A's `lastSyncedAt` at or after their `lastModified`,
  so `isModifiedSinceSync` read them as unmodified and B's first bidirectional
  sync let the remote win, overwriting the freshly imported content in silence.
  The stale `remoteId` values pointed at A's pages, so B's sync wrote into another
  project's remote records.
  
  `buildBundle` now strips both fields recursively from the cloned items.
  Attribution is unaffected — `lastModified` and `lastModifiedBy` are content and
  still travel — and provenance belongs in `exportedFrom`, not in per-item remote
  pointers. The strip runs on the bundle's own deep clone, so the source document
  is left untouched.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex import-bundle` recommending `--replace` over deltas that are not content.
  
  A "differing" collision is what makes the command close with "Use `--replace` to
  overwrite the tree with the bundle instead", so it has to mean the item's
  content differs. It did not. `sameContent` compared every field except
  `children`, including the per-item bookkeeping — and that bookkeeping diverges
  as a matter of course: the import stamps the local copy with the importing actor
  and the time it landed, while a local `rex sync` writes `lastSyncedAt` and
  `remoteId` that the bundle no longer carries at all, since export now strips
  them. Re-importing a round-tripped bundle therefore reported its overlap as
  content collisions and pointed the operator at the one command that can discard
  the whole tree, over items nobody had changed.
  
  Collision kind now ignores `lastModified`, `lastModifiedBy`, `lastSyncedAt` and
  `remoteId`. A genuine edit is still reported as differing.
  
  The field list is now declared once, in `sync.ts`, and shared. It had been
  written out three times — twice in `sync.ts` itself, as two byte-identical sets,
  and once implicitly by the bundle comparison that omitted it. `itemSignature` is
  deliberately *not* reused wholesale: it folds `children` in as an id list, which
  would make a parent read as differing merely because the bundle brought it a new
  child, re-introducing the same spurious collision from the other direction.
  
  The round-trip e2e test asserted the collision count but not the kind, so it
  passed whether every collision was identical or differing. It now asserts the
  kind.

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - test(rex): count comparisons instead of timing them in the scoped consolidation complexity gate
  
  `add-auto-reshape.test.ts` asserted that the scoped consolidation pass grows
  sub-quadratically by comparing two wall-clock readings. It failed on an idle
  machine at 8.6x against an 8x bound, and failed reliably under the CPU load of an
  `ndx work` run — which took the hench pre-commit test gate red on every task,
  for reasons unrelated to the code under test.
  
  Tuning the bound could not fix it. The readings were dominated by loading the
  tree (26 vs 101 items) rather than by the cohort scan the test claimed to guard,
  so the signal was a minority of what was measured and the noise floor sat at the
  threshold. The test had already been hardened three times (absolute budget →
  growth ratio, shared store → one store per size, single shot → min of 7).
  
  It now counts calls to `similarity`, the pairwise content-comparison primitive
  that defines the complexity: grouping by normalized title calls it once per
  colliding pair, while comparing every sibling against every other calls it O(n²)
  times. Counts are exact integers, so the result is identical on an idle machine
  and a saturated one. Verified in the failing direction — a nested pairwise scan
  added to `detectNonDuplicateTitleCollisions` took the 24-sibling count from 12 to
  288 and the growth from 4x to 16x.
  
  The test no longer builds a store or touches disk: ~35s of setup and a raised
  60s timeout are gone, and the file runs in under 3s.
  
  No production behaviour changes.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop a bundle's unvalidated `exportedAt` becoming an item's `lastModified`.
  
  `parseBundle` checks only that `exportedAt` is a string, and the import path
  then wrote it straight onto any item that arrived with an author but no
  timestamp. So a bundle declaring `"exportedAt": "yesterday"` put that literal on
  disk. `isModifiedSinceSync` compares timestamps as strings, and `"yesterday"`
  sorts above every ISO stamp, so such an item read as dirty on every sync forever
  and won last-write-wins against every genuine remote edit. A future-dated ISO
  value did the same without looking malformed.
  
  The default is removed rather than validated. It had become redundant: the store
  transaction already fills a missing timestamp and preserves the original author,
  so the item still lands sync-visible and correctly attributed. It also ran
  first, so the unvalidated value won over the checked one.
  
  The argument for keeping it — that `exportedAt` says the content is *at least*
  that old, which is more honest than "when it landed here" — is real but does not
  survive who it applies to. rex writes both stamp halves together, so the only
  items reaching that path come from hand-authored or third-party bundles: the
  same untrusted source as the `exportedAt` being trusted to describe them.
  
  Filling a missing timestamp is now the store transaction's job and only its job.
  `exportedAt` remains bundle provenance, reported and logged, and no longer
  reaches any stored field.

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

- [#351](https://github.com/en-dash-consulting/n-dx/pull/351) [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e) Thanks [@endash-shal](https://github.com/endash-shal)! - Run shell commands in a shell that exists on Windows.
  
  `execShellCmd` hardcoded `sh -c` on every platform. On Windows `sh` ships with
  Git for Windows and is on PATH only inside Git Bash, so from PowerShell or
  cmd.exe — the default shells — the spawn failed with ENOENT. `exec` reported
  that as `exitCode: 1` with empty output, which is indistinguishable from a
  command that ran and failed: hench's test gate concluded the suite was broken
  after essentially every task, and `rex verify` reported `passed: false` for
  tests that never started.
  
  `execShellCmd` now resolves the shell per platform — `sh -c` wherever a POSIX
  shell is resolvable, `cmd.exe /d /s /c` on a Windows box without one. POSIX
  behaviour is unchanged, and Windows machines that have Git for Windows keep
  POSIX semantics rather than being switched to cmd.exe.
  
  `ExecResult` gains `launched`, which is `false` when the command never started.
  Callers that infer pass/fail from `exitCode` alone can no longer mistake an
  unlaunchable command for a failing one; `rex verify` and hench's `run_command`
  now report the two cases differently.
  
  The two remaining sites that spawned `sh` directly (hench's `execShell`, rex's
  `verify`) are routed through `execShellCmd`, and an architecture-policy guard
  fails the build if a new one appears.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Record a bundle import in the execution log.
  
  `.rex/execution-log.jsonl` is the append-only record of PRD activity, and every
  other write path writes to it — add, update, move, remove, prune, reshape,
  reorganize, fix, smart-add, sync. `import-bundle` wrote nothing, so after an
  import nobody could say where the items came from, who ran it, or whether it was
  a merge or a replace: the dashboard's activity view showed a PRD that had
  changed size with no cause. It mattered most on `--replace`, the one command that
  can discard the whole tree.
  
  A successful import now appends a `bundle_imported` entry carrying the mode, the
  added / replaced / collision counts, the bundle's `exportedAt`, and its
  `exportedFrom` branch and commit when present. `appendLog` stamps the actor, so
  the entry answers who as well as what.
  
  The entry is written after the tree write, so a rejected bundle or a declined
  `--replace` leaves the log as silent as it leaves the tree. It is an audit
  record, not a third recovery mechanism: the snapshot and the archive batch exist
  to get items back, while the log preserves what the resulting tree cannot show.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the `rex import-bundle --replace` prompt understating what it will destroy.
  
  The confirmation quoted `existing.items.length` — the number of *top-level*
  items. A PRD of 3 epics holding 240 features, tasks and subtasks asked
  
      Replace the existing PRD (3 items) with the bundle? [y/N]
  
  and then reported `Replaced 240 items`. The one message whose only job is to
  convey the scale of an irreversible wipe understated it by roughly eightyfold.
  
  The prompt now quotes `countItems`, which is what `mergeBundle` already uses for
  the `replaced` count it reports afterwards, so the number the operator agrees to
  and the number they are charged cannot disagree.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Make `rex import-bundle` undoable.
  
  `snapshot-guard.ts` states the guarantee it exists to keep: every command that
  rewrites `.rex/prd_tree/` snapshots it first, so `rex restore` can always return
  the tree to the state it was in before the command ran. Eight commands honoured
  it. `import-bundle` did not — and `--replace --yes`, the non-interactive form in
  its own help examples, discards every local item. It left no snapshot and no
  archive batch, so recovery depended entirely on git, which is no recovery at all
  on a project that gitignores `.rex/prd_tree/`.
  
  The import now calls `ensureSnapshot`, inheriting the `--no-snapshot` opt-out
  and the fail-closed behaviour on a snapshot error rather than reimplementing
  them. The snapshot is taken after any `--replace` confirmation is answered, so a
  declined replace does not burn a slot in the retention cap.
  
  `--replace` additionally records the items it discarded to `.rex/archive.json`
  under a new `import` source, as `prune` and `reshape` do. Both records are
  needed: restoring the snapshot discards whatever the import brought in, while
  the archive keeps individual items — but not their placement — after the
  snapshot has aged out of the retention cap.
  
  `rex import-bundle --help` documents both the snapshot and `--no-snapshot`.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop the PRD lock being taken from a process that is still running.
  
  A lock file was treated as stale when its owner was dead **or** when it was
  simply older than 30 seconds. The second half is not a safety net — a hung
  process and a slow one look identical from the outside, and unlinking a running
  writer's lock does not fence that writer off. It admits a second writer into the
  critical section beside it, which is a lost update.
  
  This was observed rather than theorised. Two concurrent `rex import-bundle`
  processes on a loaded machine both entered the critical section, and the
  second's save was rejected by the stale-save guard for deleting an item the
  first had written moments earlier. It surfaced as an intermittent
  `import-bundle-transaction` failure that passed on every re-run — a healthy
  import holds the lock well past 30 seconds when the whole test suite is
  competing for the disk.
  
  Liveness now decides on its own: another process's lock is reclaimed only when
  that process is gone. The `staleMs` option is removed rather than left in place
  doing nothing, since a knob that silently governs nothing is worse than no knob.
  
  The trade is deliberate. A lock whose owner died and whose PID has since been
  recycled by an unrelated live process will not be reclaimed automatically, and
  writers fail after the existing acquire timeout with an error naming the holding
  PID and the path to delete. That is loud, bounded and recoverable; a silently
  interleaved write is none of those.

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

- [#361](https://github.com/en-dash-consulting/n-dx/pull/361) [`ab8dccd`](https://github.com/en-dash-consulting/n-dx/commit/ab8dccd9fadf527a84085f079b245dbdb2dc8ce2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Extract the CLI's `resolveDir()` (last positional argument, or `process.cwd()`) into its own module (`src/cli/resolve-dir.ts`) so the cwd-relative contract behind `rex mcp .` — and every other `rex <command> .` — can be unit-tested directly, without executing the CLI's top-level `main()`. No behavior change.

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

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex import-bundle --replace` clearing the destination's own remote pointers.
  
  `remoteId` and `lastSyncedAt` say which record in *this* project's remote an item
  maps to, and when it was last reconciled. A bundle cannot know either — export
  strips them so one project's pointers never reach another — so their absence
  from a bundle is silence, not an instruction to clear.
  
  `--replace` read it as an instruction, and installed items with neither over
  local items that had both. Two consequences on the same-project
  export → edit → replace round trip the feature documents. Every item lost
  `lastSyncedAt`, so `isModifiedSinceSync` went true tree-wide and the next
  `rex sync` would push the whole tree and win every field conflict against remote
  edits made since. And `remove-feature.ts` collects its "this item is synced,
  warn before deleting" list by `remoteId`, so `rex remove` silently stopped
  offering to clean up the remote records. Inert without a remote adapter
  configured, since the fields are never set there.
  
  A replace now carries the destination's pointers onto the ids that survive it.
  An id the destination has never seen gets none, which also clears anything a
  hand-authored bundle tried to smuggle in — `parseBundle` already stripped those,
  and `mergeBundle` now holds the same guarantee on its own terms rather than by
  its caller's good behaviour.
  
  The export-side guarantee is unchanged: a bundle still carries no remote
  pointers at all.

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

- [#366](https://github.com/en-dash-consulting/n-dx/pull/366) [`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the project directory being analyzed, instead of inheriting the calling process's own cwd.
  
  `rex analyze <dir>` and `sv analyze <dir>` (and the other LLM-assisted commands that share the same module-level client — `reorganize`, `prune`, `reshape`, `smart-add`, and the reorganize MCP tool) now call `setProjectDir(dir)` alongside `setClaudeConfig`/`setLLMConfig`, so the vendor CLI resolves its own project context (CLAUDE.md, `.mcp.json`) against the directory being analyzed rather than wherever the command was invoked from. Matches the fix already applied to the dashboard's Ask route.

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

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop an attribution-only item being permanently invisible to remote sync.
  
  `stampChangedItems` treated `lastModifiedBy` as a complete stamp and skipped the
  item, which protected the original author — a bundle import carries attribution
  for items whose source project never recorded a timestamp, and overwriting it
  would destroy exactly the provenance a transport artifact exists to preserve.
  But it bought that at the cost of the other half: `isModifiedSinceSync` opens
  with `if (!meta.lastModified) return false`, so such an item was never
  considered modified, and it could not acquire a timestamp later either, because
  from the next transaction on the snapshot records it as pre-existing and
  unchanged. The item was never pushed, and the next pull overwrote its content
  with the remote's value in silence.
  
  The two halves are now filled independently: a new item always leaves with a
  `lastModified`, and its `lastModifiedBy` is set only when it brought none. An
  item that arrives with a timestamp but no author is left alone — it is already
  visible to sync, and the actor running the transaction did not write it, so
  recording them would be a fabricated attribution rather than a default.
  
  This closes the general case behind a defect previously fixed only for bundle
  import. `stampChangedItems` runs inside every `withTransaction` on both store
  adapters, so any other path inserting an attribution-only item — an MCP
  `add_item`, a hand-edited `index.md` picked up by a later transaction — hit the
  same silent loss. Bundle import still defaults the timestamp to the bundle's
  `exportedAt`, which is a more honest value than "now" and is left untouched
  here.

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop a null `lastModified` slipping past the stamp repair.
  
  `stampChangedItems` decided an item already had a timestamp with
  `!== undefined`, while its only consumer opens with
  `if (!meta.lastModified) return false`. So `null` and `""` were "no timestamp"
  to the reader and "has one" to the guard, and the repair skipped exactly the
  items it exists for.
  
  The consequence was permanent. The frontmatter emitter drops the null, so from
  the next load the item reads as pre-existing and unchanged, can never acquire a
  stamp, is never pushed to a remote, and is overwritten by the remote's value on
  the next pull — the silent sync invisibility this repair was written to prevent,
  reached through a different door. `rex export` never emits a null, so it takes a
  hand-authored or third-party bundle; the document schema is a passthrough and
  never declares the field, so such a bundle validates cleanly on the way in.
  
  Both halves of the stamp now use truthiness, matching the consumer. The author
  half had the same split, with a milder cost — a dropped author loses provenance
  rather than sync visibility.

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

- [#357](https://github.com/en-dash-consulting/n-dx/pull/357) [`39bff34`](https://github.com/en-dash-consulting/n-dx/commit/39bff349a349b4cfc5bd96a4b6ec6fde925fb002) Thanks [@endash-shal](https://github.com/endash-shal)! - Record the folder tree's schema version, so a document reports what wrote it.
  
  The tree load path hardcoded the running `SCHEMA_VERSION`, and `tree-meta.json`
  held only the title. A document therefore reported whichever rex read it rather
  than whichever wrote it, which defeats forward compatibility at one remove: the
  document schema is a `.passthrough()` and `isCompatibleSchema` admits newer
  minors, so a tree written by a future `rex/v1.1` loads here intact — unrecognised
  fields included — while claiming to be `rex/v1`. Exporting it produced a bundle
  labelled `rex/v1`, and `parseBundle`'s minor gate then compared equal minors and
  admitted those fields into another tree unvalidated. That is the hole
  `buildBundle`'s `doc.schema` stamp was meant to close, reached by a different
  route; this is what makes `doc.schema` worth stamping.
  
  `tree-meta.json` now carries `schema` alongside `title`, and both store adapters
  read it back. A tree written before the marker existed keeps loading — an absent
  or non-string marker falls back to the running version rather than being treated
  as corrupt.
  
  A marker that *is* a string is returned verbatim, including one this rex cannot
  read. The compatibility checks downstream are what should refuse `rex/v2`, and
  they can only do that if the value reaches them.
  
  The four writers of this file use three different mechanisms, for durability
  reasons that still hold, so only the *shape* is consolidated — in a new
  `store/tree-meta.ts` — which is enough to stop the schema field quietly going
  missing from one of them.
- Updated dependencies [[`25d7aa6`](https://github.com/en-dash-consulting/n-dx/commit/25d7aa662c414e831fc41dbfc259db94782e0bda), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`8a117e9`](https://github.com/en-dash-consulting/n-dx/commit/8a117e930e44eec6ff73f7844fc32c05e999cb13), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9), [`d21d0ab`](https://github.com/en-dash-consulting/n-dx/commit/d21d0ab9d291fe444726d038415d8cddd5fc8e8e), [`94dc3bb`](https://github.com/en-dash-consulting/n-dx/commit/94dc3bb9b2e7e82b3d13e73059e43a78f69e30a9)]:
  - @n-dx/llm-client@0.6.0

## 0.5.2

### Patch Changes

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Stop `rex add` hanging forever when stdin is an open pipe.
  
  `dispatchAdd` awaited `readStdin()` before deciding which mode it was in, so
  every invocation paid for the piped-description form. `readStdin` guards on
  `isTTY`, and a `/dev/null` redirect reaches EOF at once — so the bug was
  invisible interactively and in most scripts, and bit the caller that matters
  most: anything spawning the CLI with `stdio: "pipe"` and no intention of
  writing. The pipe never closes, `end` never fires, and the command waits
  forever with no output. Manual mode is identified entirely by argv, so it now
  runs without touching stdin: 147ms instead of unbounded.
  
  Two related faults surfaced while testing:
  
  - An unrecognised `--level` fell through to smart mode, which then waited on
    stdin for a description that was never coming — a typo presented as a hang.
    It is now an error naming the valid levels.
  - The remaining legitimate waits were silent. They now announce themselves on
    stderr after two seconds. The read itself is deliberately *not* bounded: a
    first attempt cut it off after a deadline and silently discarded a payload
    whose first byte arrived at three seconds. Losing piped input is worse than
    waiting for it, so the fix bounds the silence rather than the read.
  
  The piped smart-add form (`echo "desc" | rex add`) is unchanged.

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

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Replace identical-prompt retries with an escalation ladder.
  
  The retry path resent a byte-identical prompt up to three times and told the
  model nothing about why the previous answer was rejected. A model that emits
  unparseable JSON once will usually do it again given the same input, so those
  were three calls billed for one answer.
  
  Retries now carry the validation error verbatim, and run on the standard tier.
  That is two independent wins for different classes: the error feedback helps
  every class — it is the actual complaint behind the audit finding — while model
  escalation only changes anything for light-routed classes, where it is what
  makes cheap-first routing safe. A light model that cannot satisfy the contract
  hands off instead of failing the command. The attempt number is included in the
  feedback, so consecutive prompts differ even when the error repeats, which is
  the property the old loop violated.
  
  The retry count is unchanged at three attempts: this changes how retries
  behave, not how many there are. Only validation failures escalate — transport
  and auth errors propagate immediately, since escalating them neither diagnoses
  nor fixes anything. Sourcevision's prompt-degradation ladder is untouched: it
  shortens the prompt on the same model, which is right for a context-overflow
  failure, while this escalates the model on the same prompt, which is right for
  a capability failure. The failure class decides which applies.
  
  Applied to `prd.modify` (the audit's named site), `prd.rename`, and
  `prd.merge`. Along the way, rename's title-collision check moved *inside* the
  output contract: it used to run after every retry, so a light model returning
  two identical titles failed the rename outright — now the standard tier gets a
  chance at it.
  
  Escalation rates are tracked per task class, so a class escalating on more than
  a fifth of its calls — the signal that its light routing is not paying for
  itself — is visible rather than inferred.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Hold the folder-tree lock across `syncFolderTree`, and give both stores one
  lock name for the tree.
  
  `syncFolderTree` — run after every PRD mutation, from the CLI and from every
  MCP write handler — did an unlocked `loadDocument()` followed by an unlocked
  full re-serialize of `.rex/prd_tree/`. Serialization deletes every on-disk
  entry absent from the snapshot, so the sync was a read-modify-write racing
  whatever writer came next, with two failure modes:
  
  - **Crash.** The read could observe a half-created item directory (an item
    gaining its first child converts a bare `<slug>.md` into a `<slug>/`
    directory), `parseFolderTree` threw ENOENT, and the handler returned
    `isError`. This is the flake behind
    `concurrent-write-lost-update.test.ts > an item inserted while
    update_task_status deletes another survives`, which failed only under CI
    load because the overlap window is timing-dependent.
  - **Silent lost update.** The sync passed no `loadedAt`, which disables the
    serializer's stale-save guard, so it would delete a concurrent writer's
    items with no error — the exact hole the surrounding suite exists to pin.
  
  The sync now runs its load and its serialize inside one lock acquisition. That
  closes both: it sees the committed tree rather than a transient one, and its
  snapshot cannot go stale while it holds the lock (so no `loadedAt` proof is
  needed).
  
  Separately, `FileStore` guarded the tree with `tree.lock` while
  `FolderTreeStore` used `prd.lock`. Two names for one resource meant a writer
  on each store could rewrite `.rex/prd_tree/` simultaneously with neither
  seeing the other. Both now derive the path from `prdLockPath()` in
  `store/paths.ts`, alongside `PRD_TREE_DIRNAME`.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Complete light-tier routing: move classification to the light tier, and give
  the two unguarded light calls real output contracts.
  
  `sourcevision`'s classification batches now resolve through the `code.classify`
  task class. This is the last of the audit's routing-map flips and the safest of
  them: a fixed-size batch goes in, an enum-constrained list comes out, unknown
  paths and unknown archetype ids are already dropped per item, and a prompt
  degradation ladder already handles parse failures — so a wrong answer costs one
  dropped classification.
  
  Routing a call to the cheapest adequate model is only a safe trade while bad
  output stays detectable, and two light-routed calls had nothing checking them.
  
  The commit-subject call feeds `git commit -m` directly, and previously took the
  first non-empty line and sliced it to 100 characters — so a fenced block, a
  "Sure! Here's a subject:" preamble, or a markdown bullet would have been
  committed into the repository's history. It now goes through a contract that
  strips those tics and enforces one line within the documented 72-character
  bound, falling back to the generic message when nothing usable survives:
  refusing to commit would be worse than committing under a generic subject.
  
  The body-merge call was worse — whatever the model returned was written verbatim
  as the surviving PRD item's description, so an empty answer or a JSON blob would
  have been persisted as the item's body. It now validates, and *throws* on
  failure rather than repairing: `reshape` already treats body merge as
  best-effort and keeps the existing description, which beats persisting a
  preamble or a sentence cut in half by a length cap.
  
  The other six light-routed sites were audited and already had contracts — zod
  schemas for renames, clarify rounds and the assessment pass, and proposal
  parsing with count checks for the consolidation guard. A new integration test
  pins the resolved model for every class in the routing map, in both directions:
  the light routes must be light, and the agent loop, proposal generation, and
  deep enrichment must not be.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Compact the JSON that rex prompts send and ask for.
  
  Six prompt builders embedded their payload with `JSON.stringify(x, null, 2)` —
  guard, breakdown, consolidate, assess, modify, decompose. Indentation is billed
  as input on every analyze call and buys nothing: the model reads the shape from
  the keys, not the whitespace. On a five-proposal payload the embedded JSON drops
  37% (9,297 → 5,896 characters).
  
  The two few-shot examples were hand-written pretty JSON, so they carried the
  same cost and, once the prompts started asking for minified output, contradicted
  their own instruction. Both are now minified.
  
  Output is where the real saving is — output tokens cost roughly 5x input on
  every tier — so the shared `OUTPUT_INSTRUCTION` and the bespoke instructions in
  the assessment, decompose, and reshape prompts now ask for minified JSON
  explicitly ("no whitespace between tokens, no indentation, no line breaks") and
  tell the model not to restate the input.
  
  Response parsers are unchanged and still pass: they already tolerated fences and
  surrounding prose, and compact JSON parses identically.
  
  The new `prompt-json-discipline.test.ts` builds each prompt and asserts the
  result carries no indented JSON and does ask for minified output. It checks
  behaviour rather than grepping for `null, 2`, because grep cannot tell a prompt
  from the many legitimate pretty-printers in the tree — `--format=json` CLI
  output and on-disk config files are supposed to stay readable, and were left
  alone.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Report PRD tree paths written in a foreign slug convention, and pin write-path
  parity.
  
  A rex build older than the id-qualified slug rule (landed 2026-08-26)
  re-serializes the whole tree to the suffix-less form on its first write —
  observed 2026-09-01 as 823 of 1398 files renamed by a single status update.
  Nothing caught it: every rename was lossless, item content was untouched, and
  `rex validate` inspects item fields without ever looking at the paths those
  items live in. So an 800-file rewrite read as a clean tree.
  
  `findNonConformingSlugs` compares each item's on-disk entry against what
  `slugify` would produce, and `rex validate` reports mismatches as warnings
  naming `rex migrate-slugs` as the repair. An item whose file is merely missing
  is not reported — that is a separate fault, and folding it in would make this
  finding noisy enough to ignore.
  
  Also adds `write-path-parity.test.ts`, which disproves the assumption that
  prompted this work: the MCP handler and the CLI's update sequence produce
  byte-identical trees, and a status update rewrites at most three files at
  steady state. The suspected divergence was not in either code path.

- [#346](https://github.com/en-dash-consulting/n-dx/pull/346) [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec) Thanks [@endash-shal](https://github.com/endash-shal)! - Thread task classes through every package's LLM choke point, and pass the
  routing config surfaces through the `.n-dx.json` loader.
  
  rex's `spawnClaude`/`resolveConfiguredModel` accept `{ taskClass }` alongside
  the legacy bare weight (the class wins; an explicit model still beats both),
  and the analyze call sites now declare their classes — renames, merges,
  consolidation checks, assessment, and clarify rounds route light by registry
  default exactly as before, while proposals, modify, spec synthesis, smart-add,
  and restructuring declare their standard-tier classes. `prd.decompose` is
  deliberately not declared yet: its registry default is light, and that flip is
  gated on the escalation ladder. sourcevision's `callClaude` gains the same
  option, `resolveLightModel` now resolves through `zone.enrich-scan`, and the
  enrichment passes and meta-evaluation declare their classes. hench resolves
  the agent loop via `agent.execute` (standard by default — but
  `llm.routes["agent.execute"] = "heavy"` now reroutes a run with no code
  change), the pre-run commit message via `git.commit-message`, and CLI-path
  run records carry the resolved tier in `weight` instead of always "standard".
  `loadLLMConfig` passes `llm.tiers`, `llm.routes`, `llm.effort`, and
  `llm.escalation` through its whitelist so the new config actually reaches
  runtime. A repo-level contract test walks declared task classes and fails on
  any class missing from `DEFAULT_ROUTES` or any choke point that stops
  declaring its classes.
- Updated dependencies [[`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`f0cf5d3`](https://github.com/en-dash-consulting/n-dx/commit/f0cf5d3bab556b80251a47206ad5fdc0ee587e93), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec), [`4e0ca1c`](https://github.com/en-dash-consulting/n-dx/commit/4e0ca1c4c220f58855ade454e72c9500391dd0ec)]:
  - @n-dx/llm-client@0.5.2

## 0.5.1

### Patch Changes

- [#335](https://github.com/en-dash-consulting/n-dx/pull/335) [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Resolve actor identity (git `user.name`/`user.email` → `os.userInfo()` → `"unknown"`, cached per process) and stamp attribution on writes: `stampModified()` now also sets `lastModifiedBy` on PRD item mutations, and the new `stampActor()` sets `actor` on execution-log entries. Wired into every mutation-capable store: `FileStore` (the production writer), `FolderTreeStore`, and the Asana/Notion/Jira/GitHub Projects adapters. Both fields are passthrough on the existing schemas — additive, non-breaking.

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - Every PRD tree slug is now id-qualified, and `rex migrate-slugs` renames existing trees in one pass.
  
  `slugify()` emitted title-only slugs — the `-{id6}` suffix appeared only for long titles or same-tree sibling collisions. Same-titled items created on divergent branches therefore collided on identical paths, so a git merge silently unified two distinct items, and renaming an item relocated its files entirely. The suffix is now unconditional: every new write lands at `<title-slug>-<id6>`, making paths collision-free across branches (the title body is truncated to keep slugs within 40 characters, unchanged).
  
  Existing trees keep working — the parser never depended on slug shape — but their next full save would rename everything as a side effect. `rex migrate-slugs` does that rename as one deliberate, reviewable pass instead: it snapshots the tree (undoable via `rex restore`), round-trips it through the store under the PRD lock, and reports how many entries were renamed. Idempotent — a second run is a no-op. The folder-tree schema doc's naming rules, examples, and collision-resistance notes are updated to match.

- [#341](https://github.com/en-dash-consulting/n-dx/pull/341) [`2bb6a4c`](https://github.com/en-dash-consulting/n-dx/commit/2bb6a4c240e61aa34bf0d240e7ffc26c7e5a4dab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Route mechanical single-shot LLM calls to the light model tier. In rex, `spawnClaude()` gains an optional task-weight parameter (default `"standard"`), and sibling renames, group renames, body merges, the consolidation guard, the granularity assessment pass, guided clarify rounds, and the post-prune consolidation pass now resolve the vendor's light-tier model (e.g. haiku) when no explicit model is given. In hench, pre-run commit-message generation resolves the light tier instead of the run's standard model. An explicit `--model` flag (or a per-vendor `lightModel` config for the light tier) still overrides tier resolution, and the active tier is surfaced in vendor-header/spinner output ("light tier").

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - New `rex merge-driver` command: a three-way, frontmatter-aware git merge driver for `.rex/prd_tree/`.
  
  Git's default text merge produces spurious conflicts on PRD markdown (two branches touching adjacent frontmatter lines) and silent mis-merges of list fields. The driver merges at field granularity with a rule per field class: `tags`/`blockedBy` get a three-way set merge (additions from both sides land, removals stick — never conflicts); `status`/`priority` divergence resolves to the side with the later `lastModified` stamp; `lastModified` takes the later value; every other field and the body merge plain three-way. Only genuinely conflicting fields emit standard `<<<<<<<`/`>>>>>>>` markers — everything mergeable still merges around them — and the driver exits nonzero so git marks the path conflicted, per the merge-driver protocol (result written to the %A path).
  
  Register per repository (a future `ndx init` change will do this automatically):
  
  ```
  git config merge.rex-prd.name   "n-dx PRD tree merge"
  git config merge.rex-prd.driver "rex merge-driver %O %A %B"
  echo '.rex/prd_tree/** merge=rex-prd' >> .gitattributes
  ```

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - Saving a stale PRD snapshot now fails loudly instead of silently deleting another writer's items.
  
  Every save of the PRD folder tree removes on-disk items absent from the document being saved — a full-replacement contract that made a save from a pre-merge or stale snapshot silently destroy items it never loaded, with only the gitignored local `.rex/.backups/` for recovery.
  
  The serializer now collects deletions instead of applying them mid-walk, and guards them before deleting anything: a deletion candidate whose on-disk state is newer than the document's load time (recursively — a fresh child inside an old folder counts) aborts the entire save with an error naming each item that would have been destroyed, its id, and its path. Both stores stamp the load time on every `loadDocument` and refresh it after their own successful saves, so normal load-edit-save flows and same-writer sequential saves are unchanged while a genuinely stale snapshot is refused. A save that never loaded the tree may not delete at all; a deliberate whole-tree rewrite (migration, restore) states its intent with the serializer's explicit `allowBulkDelete` option.

- [#335](https://github.com/en-dash-consulting/n-dx/pull/335) [`1f6f17c`](https://github.com/en-dash-consulting/n-dx/commit/1f6f17c32b0ae387ab0e927688ce71ad6859fb3b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Stamp an ISO `lastModified` on every `FolderTreeStore` mutation (`addItem`, `updateItem`, and — on the affected parent — `removeItem`). Previously `FolderTreeStore` ignored this entirely, so `SyncEngine.isModifiedSinceSync()` always returned false for folder-tree-backed items and locally edited items were silently skipped on `push`. `lastModified` is an existing passthrough field (see `packages/rex/src/core/sync.ts`), so this is additive and does not change the PRD schema.

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

- [#343](https://github.com/en-dash-consulting/n-dx/pull/343) [`e02a5fe`](https://github.com/en-dash-consulting/n-dx/commit/e02a5fee539a091a456a17994fa5e8d0ba491558) Thanks [@endash-shal](https://github.com/endash-shal)! - New `rex validate --post-merge`: structural check for a freshly merged PRD tree, with `--repair` for the safe classes.
  
  A git merge of `.rex/prd_tree/` can leave corruption no rex code path produces, and none of it errored: duplicate IDs (both branches created or moved the same item at different paths), directories whose `index.md` was lost in conflict resolution, files at the wrong nesting depth, `blockedBy` references to items the other branch deleted, and unresolved conflict markers. The scan reads the raw tree — deliberately not the store, whose parser would normalize or choke on exactly this input — and reports every class.
  
  `--repair` fixes the deterministic classes (empty orphaned directories removed, `level` rewritten to the depth-implied value, dangling `blockedBy` ids dropped while valid ones are kept) and refuses the ambiguous ones (duplicate IDs, conflict markers, orphaned directories that still contain items) with instructions. Exit codes are hook-friendly — 0 clean, including a repo with no PRD tree; 1 issues remain — and the folder-tree schema doc shows the optional git post-merge hook wiring.

- [#331](https://github.com/en-dash-consulting/n-dx/pull/331) [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9) Thanks [@jeremylumanbailey](https://github.com/jeremylumanbailey)! - Add `--verbose`/`--debug` live progress across `ndx init` and `sourcevision analyze`, and replace scattered vendor string literals with shared `LLM_VENDOR` constants.
  
  **Live progress instrumentation.** `ndx init` gave no visibility into a slow `sourcevision analyze` run — `--debug` reached the child process but its output was fully captured and discarded on success, so a slow run was indistinguishable from a hung one. `ndx init`'s spinner now forwards the child's own progress live (throttled so a high-volume `--debug` firehose can't stall the pipe via backpressure), and the Components phase (component parsing, route detection, server-route detection) gets per-operation timestamped tracing plus automatic gap detection that flags any silence past 250ms by naming the last known checkpoint. A worker-thread-backed live stopwatch prints an incrementing "current operation runtime" for any operation still in flight — verified to keep ticking even during a fully synchronous, non-yielding block, which a same-thread timer cannot do. `hench`'s shell tool gets equivalent live-tail output for long-running commands.
  
  **Fixed a real infinite loop this instrumentation surfaced.** `inferPrefix` (server-route prefix inference) could spin forever on any two ordinary routes that share no deeper common path (e.g. `/users/:id` and `/orders`) — confirmed live via a CPU sample showing 100% of time in `String.prototype.lastIndexOf`. Also tightens `isLikelyRouteFile` so a client-side `api/` directory (axios/fetch-style callers, not Express-style route definitions) is no longer scanned for server routes at all, and adds a length guard against any future misextracted route "path" that's actually an unrelated string literal.
  
  **Vendor literal consolidation.** Replaces hardcoded `"claude"`/`"codex"`/`"google"`/`"local"` string comparisons throughout `core`, `hench`, `rex`, `sourcevision`, and `web` with the canonical `LLM_VENDOR`/`DEFAULT_LLM_VENDOR`/`LLM_VENDORS`/`isLLMVendor` helpers exported from `provider-interface.ts` and re-exported through each package's llm-client gateway, so the supported-vendor set has one source of truth instead of being duplicated ad hoc at each call site.
  
  **Fixed `ndx config <key>` incorrectly reporting an initialized project as stale.** The pre-dispatch directory resolver used for the staleness check and command-timeout config load treated a config key like `llm` as a target directory when no explicit directory argument was given, so `ndx config llm` looked for `.sourcevision`/`.rex`/`.hench` under a nonexistent `llm/` subdirectory and reported a fully-initialized project as uninitialized.
- Updated dependencies [[`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`b6be7f7`](https://github.com/en-dash-consulting/n-dx/commit/b6be7f7f80232fe9b1b45479040db6f81bf6bbce), [`a7b3227`](https://github.com/en-dash-consulting/n-dx/commit/a7b3227e42f778bedb0e19343cf42443f545c167), [`a1ab6cc`](https://github.com/en-dash-consulting/n-dx/commit/a1ab6cc90d5ae171fddcc623c670a1e1c0df2a12), [`cfdd3b5`](https://github.com/en-dash-consulting/n-dx/commit/cfdd3b5d3f53ad7e6a032fa855ba66a359818be9)]:
  - @n-dx/llm-client@0.5.1

## 0.5.0

### Patch Changes

- [#317](https://github.com/en-dash-consulting/n-dx/pull/317) [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92) Thanks [@endash-shal](https://github.com/endash-shal)! - Surface concise re-authentication guidance when a provider rejects credentials, and stop dumping raw JSON error payloads.
  
  A new canonical helper in `@n-dx/llm-client` (`authFailureGuidance` / `authFailureMessage`) is the single source of truth for auth-failure wording: it names the provider, states the cause (`Invalid or expired credentials`), and gives the exact fix — `claude logout && claude login`, `codex logout && codex login`, or `ndx config llm.google.api_key <KEY>`. Every entry point now reads identically:
  
  - **`ndx init` / `ndx config llm.vendor`** — the core preflight (`packages/core/config.js`) replaces the verbose `Details: <raw JSON>` dump with the concise, ANSI-colored guidance (red headline, yellow remediation). The NDX error code (e.g. `NDX_CLAUDE_PREFLIGHT_AUTH_REQUIRED`) is demoted to a dim secondary line instead of the headline, and JSON payloads are never printed. A missing Google key gets a distinct "No API key configured" message.
  - **`ndx work`** — the runtime LLM providers already throw `AuthFailureError`; its message is now the canonical, JSON-free line.
  - **`ndx plan` / `ndx analyze`** — rex/sourcevision route auth errors through the shared classifier and (for rex) render `AuthFailureError` with the shared remediation.

- [#316](https://github.com/en-dash-consulting/n-dx/pull/316) [`c5fdbed`](https://github.com/en-dash-consulting/n-dx/commit/c5fdbed684ee91e1b6ceeb77b64bbb3f12b98600) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(hench): make parent auto-completion self-healing so cascades are no longer silently lost ([#293](https://github.com/en-dash-consulting/n-dx/issues/293))
  
  During `hench run --auto --loop`, a child task could be persisted as `completed` while the parent auto-completion cascade was silently dropped — leaving parent features stuck `pending` with every child done, and no reconciliation path to recover. The cause: in `toolRexUpdateStatus` the `status_updated` log append and the cascade shared the caller's single best-effort `try/catch`, so a log-append failure after the child's status write cancelled the cascade; and the cascade was event-driven (`findAutoCompletions` walks only the triggering item's ancestor chain), so a missed cascade was never retried.
  
  Two changes:
  
  - **rex:** add `reconcileAutoCompletions(items)` — a whole-tree, bottom-up sweep that completes every parent whose children are all terminal (`completed`/`deferred`), independent of any single trigger item. It self-heals parents whose earlier cascade was lost. Exported from `public.ts`.
  - **hench:** in `toolRexUpdateStatus`, wrap the `status_updated` append in its own try/catch so a log failure can no longer cancel the cascade, and drive the cascade with `reconcileAutoCompletions` (via `rex-gateway`) for whole-tree healing. Cascade failures in `updateCompletedTaskStatus` and the finalize path are now recorded in `run.diagnostics.notes` instead of a console-only warning.

- [#328](https://github.com/en-dash-consulting/n-dx/pull/328) [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the dashboard Reshape preview always reporting "no proposals": the server now spawns `rex reshape --format=json --quiet` so stdout is pure JSON (info() progress prose no longer breaks the report parse), and `rex reshape --format=json` emits a JSON report (`proposals: []`) instead of prose when no proposals are found.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Asana as a work-tracking integration target. A new built-in `asana` store adapter syncs the PRD tree to tasks in an Asana project: `rex adapter add asana --token=<pat> --projectId=<gid>` configures the connection (token redacted to `REX_ASANA_TOKEN`), and `rex sync --adapter=asana` creates/updates Asana tasks through the existing `SyncEngine`, which reports per-item results. The PRD hierarchy maps onto Asana subtasks; each task's native `external` field carries the PRD item id plus level/status/priority and other PRD-only metadata, so rex-managed tasks round-trip faithfully while tasks authored in the Asana UI degrade gracefully (level inferred by depth, status from the completed flag). Kept separate from the Notion, Jira, and GitHub Projects integrations. Adds an `asana` integration schema for the web UI and folds the duplicated built-in-adapter name list into an exported `BUILT_IN_NAMES` set.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add GitHub Projects as a work-tracking integration target. A new built-in `github` store adapter syncs the PRD tree to a GitHub Projects (v2) board: `rex adapter add github --token=<pat> --projectId=<PVT_...>` configures the connection (token redacted to `REX_GITHUB_TOKEN`), and `rex sync --adapter=github` creates/updates project draft issues through the existing `SyncEngine`, which reports per-item results. GitHub Projects v2 is a flat collection with no `external` field or native hierarchy, so each PRD item is stored as a draft issue whose body carries the human-readable description + acceptance criteria plus a hidden `<!-- n-dx-meta: {json} -->` footer holding the PRD id, parent id, level, status, priority and other PRD-only metadata; the tree is reconstructed from the footer's parent id. Draft issues authored in the GitHub UI degrade gracefully. The adapter talks to the GitHub GraphQL API via `fetch` (no new dependency). Adds a `github` integration schema for the web UI. Kept separate from the Notion, Jira, and Asana integrations.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add Jira as a work-tracking integration target. The existing `jira` integration schema (previously a UI-only stub) is now backed by a built-in `jira` store adapter that syncs the PRD tree to Jira issues: `rex adapter add jira --domain=<host> --email=<email> --apiToken=<token> --projectKey=<KEY>` configures the connection (API token redacted to `REX_JIRA_API_TOKEN`), and `rex sync --adapter=jira` creates/updates issues through the existing `SyncEngine`, which reports per-item results. Each PRD item maps to a Jira issue of the configured type (default "Task"); summary ↔ title, description + acceptance criteria render into the issue description (converted to Atlassian Document Format by the client), and the PRD id, parent id, level, status, priority and other PRD-only metadata are carried in a hidden `<!-- n-dx-meta: {json} -->` footer so the tree round-trips. When label sync is enabled, PRD tags are also written to Jira labels (sanitized). The client talks to the Jira Cloud REST API v3 via `fetch` with Basic auth (no new dependency). Kept separate from the Notion, Asana, and GitHub Projects integrations.

- [#298](https://github.com/en-dash-consulting/n-dx/pull/298) [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad) Thanks [@endash-shal](https://github.com/endash-shal)! - Add a common PRD-to-work-item linkage model. `PRDItem` now carries an optional structured `links` array (`WorkItemLink`), the system-agnostic surface every work-tracking integration (Notion, Jira, GitHub Projects, Asana, …) uses to record the relationship between a PRD requirement and its downstream work item — link identity is `(system, workItemId)`. A new `core/work-item-link.ts` module exposes pure, immutable operations — `getLinks`, `findLink`, `upsertLink`, `removeLink`, `updateLinkSyncState` — so a linkage is stored when a work item is created (`upsertLink`) and reflects the latest known remote state (`updateLinkSyncState` patches `syncState`/`remoteStatus`/`lastSyncedAt`/`error`). Links round-trip through the folder-tree serializer/parser (object-array frontmatter, like `commits`) with no storage changes, so they are visible whenever the PRD is loaded. Validated by `WorkItemLinkSchema` (strict). The pre-existing single `remoteId` sync field is left untouched for backward compatibility.

- [#330](https://github.com/en-dash-consulting/n-dx/pull/330) [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056) Thanks [@endash-shal](https://github.com/endash-shal)! - Local-loop tasks reset to pending on infra failures (retryable instead of deferred), `--reset-deferred` documented in hench help, and single-item PATCH via the web API restores startedAt/completedAt timestamping and status validation.

- [#318](https://github.com/en-dash-consulting/n-dx/pull/318) [`ea75b8d`](https://github.com/en-dash-consulting/n-dx/commit/ea75b8d45ea03d20a1844855a97b19c80f31a328) Thanks [@stevemikedan](https://github.com/stevemikedan)! - fix(token-usage): report actual token usage broken out by type (input/output/cache-write/cache-read), consistently in rollup and dashboard ([#294](https://github.com/en-dash-consulting/n-dx/issues/294))
  
  The per-item rollup summed cache tokens into a single conflated total (~23M for a run whose real work was ~40K), while the dashboard Usage page counted only input+output — a ~575× divergence for the same runs. Rather than pick one number, both surfaces now report the actual usage broken out by type, with no cost/pricing math.
  
  - **rex:** `ItemTokenTuple` now carries `input`, `output`, `cacheCreation`, `cacheRead`, and `total` (= their sum). `tokensFromRecord`, self/descendant attribution, and the ancestor roll-up track all four components; `get_token_usage` surfaces the breakdown.
  - **web:** the Usage-page extractor reads `cacheCreationInput`/`cacheReadInput` from run records (previously dropped), surfacing cache-write and cache-read as distinct fields and attributing run-level cache totals without double-counting across turns. `incremental-task-usage` uses the same breakdown, so the dashboard and rollup report identical numbers for the same runs.

- [#334](https://github.com/en-dash-consulting/n-dx/pull/334) [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Security and modernization pass over all dependencies. Resolves all 45 `pnpm audit` findings (2 critical, 16 high) via updated direct dependencies and refreshed pnpm overrides (hono, @hono/node-server, fast-uri, ip-address, js-yaml, nanoid, postcss, qs, vite, ws, body-parser). Modernizes major tooling: TypeScript 6.0, vitest 4.1.10, ink 7, ora 9, jsdom 30, esbuild 0.28, @modelcontextprotocol/sdk 1.30, @anthropic-ai/sdk 0.117, changesets 3. Raises the supported Node.js floor from 18 to 22 (Node 18 and 20 are both end-of-life; CI already runs Node 22).

- [#323](https://github.com/en-dash-consulting/n-dx/pull/323) [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d) Thanks [@endash-shal](https://github.com/endash-shal)! - Fix the PRD rollback snapshot on Windows, and add `rex restore` to use it.
  
  **The bug.** `snapshotPRDTree` named its backup directory `prd_tree_<raw ISO-8601 timestamp>`. ISO-8601 puts colons in the time component (`2026-08-05T17:27:18.959Z`), and `:` is illegal in Windows filenames — reserved for drive letters and NTFS alternate data streams. So the snapshot `mkdir`/`cp` failed with `EINVAL` on **every** Windows invocation. Because `add` and `reshape` caught the failure, printed a one-line warning, and continued anyway, Windows users had been running destructive tree rewrites with no rollback point at all — and the only signal was a line of text above the normal command output. Snapshot ids are now colon-free (`2026-08-05T17-27-18.959Z`), encoded positionally so lexicographic order still equals chronological order, which `getAvailableBackups` depends on.
  
  **Restore was also broken.** `restoreFromBackup` documented "Remove current tree if it exists" but performed a recursive copy with `force: true` — an overlay, not a replace. Any file a command created after the snapshot survived the "rollback", leaving a tree that was the union of both states rather than the point in time it claimed to be. Restore now stages the snapshot beside the live tree and swaps it in, so a partial failure can never leave the project with no PRD.
  
  **Snapshots are now reachable.** Added `rex restore`: lists available snapshots with timestamps and file counts, restores via `--latest` or `--id=<id>`, and confirms before replacing the tree (`--yes` to skip, `--format=json` for scripts). Previously the snapshots existed on disk with no supported way to use them, and the failure hint suggested `cp -r` — a command that does not exist in cmd.exe or PowerShell.
  
  **Coverage widened.** A new `cli/snapshot-guard.ts` centralizes the pre-command snapshot and now guards `add`, `reshape`, `prune`, `reorganize`, `remove`, `move`, and `fix`. The guard **fails closed**: if a snapshot cannot be created, the command aborts rather than rewriting the tree unprotected. `--no-snapshot` opts out for read-only filesystems and CI. `update` is deliberately excluded — it is on hench's hot path and a full-tree copy per task-status transition would be a significant regression.
  
  Regression tests assert the snapshot directory contains none of Windows' reserved characters, that encoded ids stay chronologically sortable, that restore accepts both an encoded id and a raw ISO timestamp (for snapshots written before this fix), and that restore replaces rather than overlays.
- Updated dependencies [[`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`68616e5`](https://github.com/en-dash-consulting/n-dx/commit/68616e550d0b062cee6add7e18df69a65164dd92), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`1031719`](https://github.com/en-dash-consulting/n-dx/commit/1031719e295722833e2982c720e93ff56a929fad), [`18b36f7`](https://github.com/en-dash-consulting/n-dx/commit/18b36f73c0b18bdf508b956e3fb42e5bbf5aeabd), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`615cead`](https://github.com/en-dash-consulting/n-dx/commit/615ceadaa1ac6ea261b143d0a5c3a2d4881b17f4), [`1146047`](https://github.com/en-dash-consulting/n-dx/commit/11460479eb2c3806de00fd3fb5a4e42e1164b056), [`21283a2`](https://github.com/en-dash-consulting/n-dx/commit/21283a22fcd2b68d5f016fe923e49908c141ebf0), [`b0efffd`](https://github.com/en-dash-consulting/n-dx/commit/b0efffdd35449d1e70e2ecd0df8a058aeb2c79ff), [`4206697`](https://github.com/en-dash-consulting/n-dx/commit/42066975f4b7ffcec402df7446d2a0101ff929c6), [`261c839`](https://github.com/en-dash-consulting/n-dx/commit/261c839396af3063f1d0f9a50657e86dd275a22d), [`ab24172`](https://github.com/en-dash-consulting/n-dx/commit/ab241723f3822cca76e801d4628289b3c45b0b84)]:
  - @n-dx/llm-client@0.5.0

## 0.4.6

### Patch Changes

- [#268](https://github.com/en-dash-consulting/n-dx/pull/268) [`be3b1d9`](https://github.com/en-dash-consulting/n-dx/commit/be3b1d98f70e6df6b031ed023fb7f8f5a96dba6a) Thanks [@stevemikedan](https://github.com/stevemikedan)! - Exclude `.claude/`, `.codex/`, `CLAUDE.md`, and `AGENTS.md` from the rex doc scanner. These are AI assistant tool config directories and generated instruction files that were being ingested as PRD proposals.

- [#269](https://github.com/en-dash-consulting/n-dx/pull/269) [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482) Thanks [@en-drza](https://github.com/en-drza)! - Introduced animated carolinaBlue loader and aesthetic DX improvements for long-running status and work commands.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- Updated dependencies [[`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99), [`579d831`](https://github.com/en-dash-consulting/n-dx/commit/579d831018b949938f6ad18a0a637315a2b9b352), [`545d611`](https://github.com/en-dash-consulting/n-dx/commit/545d611c9a47a372ada5e9b65f2a48d034d37482), [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2)]:
  - @n-dx/llm-client@0.4.6

## 0.4.5

### Patch Changes

- [#222](https://github.com/en-dash-consulting/n-dx/pull/222) [`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f) Thanks [@endash-shal](https://github.com/endash-shal)! - reduce code size, improve skills for claude

- Updated dependencies [[`75fe836`](https://github.com/en-dash-consulting/n-dx/commit/75fe8361174f0913d21b8cb7d393dca05cf5fa0f), [`6bdf00b`](https://github.com/en-dash-consulting/n-dx/commit/6bdf00b7af631518bbb829bb89160638b500507b)]:
  - @n-dx/llm-client@0.4.5

## 0.4.4

### Patch Changes

- Updated dependencies []:
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

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Allow partial accept inside a recommendation group via
  `rex recommend --accept=hashes:<hash>,<hash>,…`. Findings matching the listed
  hash prefixes are filtered first; the recommendation tree is regenerated from
  just those findings and accepted whole. Lets you keep the one valid finding
  inside a noisy group without forcing acks on the rest or having to take the
  group all-or-nothing.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Make `rex recommend` acknowledgement workflow address-by-hash. Each finding
  now prints with a stable 6-char hash prefix (`[a3f5d8]`) and
  `--acknowledge=<hash|index>,…` accepts either. Hashes are recommended because
  indices renumber after every ack — a planned `--acknowledge=1,5,9` no longer
  goes wrong when the first ack shifts the list.

  Adds `--unacknowledge=<hash|index>,…` to undo prior acknowledgements
  (previously required hand-editing `.rex/acknowledged-findings.json`) and
  `--reason=<category>` to capture _why_ — canonical categories are
  `tool-artifact`, `already-done`, `doesnt-apply`, `over-engineered`,
  `speculative`, and free-form values are also accepted. The recorded reason
  will later let the analyzer mine repeated junk and improve its prompts.

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

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/llm-client@0.4.2

## 0.4.1

### Patch Changes

- [#201](https://github.com/en-dash-consulting/n-dx/pull/201) [`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4) Thanks [@endash-shal](https://github.com/endash-shal)! - Adding auto-changing llm models for long runs, self-heal improvements and bug fixes.

- Updated dependencies [[`d512d05`](https://github.com/en-dash-consulting/n-dx/commit/d512d05fe8726aafa635f04b98275dc2520482e4)]:
  - @n-dx/llm-client@0.4.1

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
  - @n-dx/llm-client@0.4.0

## 0.3.4

### Patch Changes

- [#197](https://github.com/en-dash-consulting/n-dx/pull/197) [`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307) Thanks [@endash-shal](https://github.com/endash-shal)! - added more documentation changes

- Updated dependencies [[`3aabfef`](https://github.com/en-dash-consulting/n-dx/commit/3aabfefc59c0e6246767e1af0ee4e0ddf0ce8307)]:
  - @n-dx/llm-client@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.3

## 0.3.2

### Patch Changes

- [#186](https://github.com/en-dash-consulting/n-dx/pull/186) [`015b06a`](https://github.com/en-dash-consulting/n-dx/commit/015b06ad9fde134cee0f9a45e4fb310fa7a5fddd) Thanks [@endash-shal](https://github.com/endash-shal)! - new PRD structure and smaller fixes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

- [#168](https://github.com/en-dash-consulting/n-dx/pull/168) [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more codex fixes, added full codex integration and other smaller fixes

- Updated dependencies [[`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f), [`04c8310`](https://github.com/en-dash-consulting/n-dx/commit/04c8310e0ea15eb329b4839b71518d015f5f755f)]:
  - @n-dx/llm-client@0.3.0

## 0.2.3

### Patch Changes

- [#155](https://github.com/en-dash-consulting/n-dx/pull/155) [`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817) Thanks [@endash-shal](https://github.com/endash-shal)! - model and quality of experience improvements

- Updated dependencies [[`46184f2`](https://github.com/en-dash-consulting/n-dx/commit/46184f2130fef7c6394a2dba1581e3c350b3b817)]:
  - @n-dx/llm-client@0.2.3

## 0.2.2

### Patch Changes

- [#138](https://github.com/en-dash-consulting/n-dx/pull/138) [`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba) Thanks [@endash-shal](https://github.com/endash-shal)! - This change optimizes some code, adds timeouts and big fixes for major use cases. No new functionality is added.

- Updated dependencies [[`deb1b73`](https://github.com/en-dash-consulting/n-dx/commit/deb1b731a25ae3b97e833ecff82b5fa5e9045bba)]:
  - @n-dx/llm-client@0.2.2

## 0.2.1

### Patch Changes

- [#126](https://github.com/en-dash-consulting/n-dx/pull/126) [`6c88d23`](https://github.com/en-dash-consulting/n-dx/commit/6c88d237f83594c4877f0f975b383e880fd656bf) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix ndx work failing when .hench/runs/ directory is missing after a fresh clone. Add generated rex files to .gitignore on init. Exclude source map files from published packages.

- Updated dependencies []:
  - @n-dx/llm-client@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
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

- Updated dependencies [[`616c799`](https://github.com/en-dash-consulting/n-dx/commit/616c799ef0ef2ed9f96acadb6ba5540270a07a82), [`d940a48`](https://github.com/en-dash-consulting/n-dx/commit/d940a48af8ca288642efebf90a5786ee59bf6a88), [`17e486a`](https://github.com/en-dash-consulting/n-dx/commit/17e486a391d85a65e62d231539bff0a2ee212dc8)]:
  - @n-dx/llm-client@0.1.9

## 0.1.8

### Patch Changes

- [#31](https://github.com/en-dash-consulting/n-dx/pull/31) [`e83e960`](https://github.com/en-dash-consulting/n-dx/commit/e83e9601f179855b69d49a3557ce1b29bdc082f9) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix `ndx add` CLI delegation treating description as directory path, fix `isFullyCompleted` in rex prune to treat deleted children as completed, and rename Claude Code skills with `ndx-` prefix to avoid collisions with builtins.

- Updated dependencies []:
  - @n-dx/llm-client@0.1.8
