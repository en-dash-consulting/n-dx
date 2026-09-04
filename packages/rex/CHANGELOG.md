# @n-dx/rex

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
