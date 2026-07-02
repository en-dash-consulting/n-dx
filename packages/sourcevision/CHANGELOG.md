# @n-dx/sourcevision

## 0.4.6

### Patch Changes

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Keep the zone structure when LLM enrichment fails. Previously, when every enrichment batch failed (e.g. the model timed out), the pass returned only the templated build/asset/docs/config zones and silently dropped the un-enriched code zones — collapsing the analysis to a handful of structural zones with zero cross-zone crossings, despite logging "using algorithmic names". Now a failed pass falls back to the algorithmic Louvain names for the un-enriched code zones (merged with unchanged and templated zones), so a transient LLM outage costs only AI-polished names, not the zone graph or its crossings.

- [#239](https://github.com/en-dash-consulting/n-dx/pull/239) [`b9570fd`](https://github.com/en-dash-consulting/n-dx/commit/b9570fd2d7528c6e315f1a1fc6b3aa33e8537da2) Thanks [@endash-shal](https://github.com/endash-shal)! - Added Google integration

- [#243](https://github.com/en-dash-consulting/n-dx/pull/243) [`925d9a8`](https://github.com/en-dash-consulting/n-dx/commit/925d9a846e35ca8cbd98084ff5aa0152bc486f99) Thanks [@dnaniel](https://github.com/dnaniel)! - Fix stale zone-partition cache surviving a sourcevision upgrade. `analyzeZones` reuses a cached partition when the input fingerprint is unchanged, but the fingerprint omitted the partitioning-algorithm version — so after an upgrade that changes how files are grouped, projects with unchanged files kept serving the old algorithm's zones (surfacing as, e.g., an empty codebase map). A new `ZONE_ALGORITHM_VERSION` is folded into the fingerprint and bumped, so the next `analyze` recomputes instead of reusing a stale partition — no manual `.sourcevision` deletion or zone pins required.

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

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Cut enrichment LLM cost and wall-clock without quality regression.

  **Skip the LLM on structural-only zones.** Zones whose files are entirely
  non-source (build scripts, assets, docs, config — `inventory.role !==
"source"` for every file) get a templated name and description derived
  from their dominant role and top-level directory. On a typical small repo
  this skips ~30–40 % of zones entirely (gotobed: 4 of 9 — Build & CI
  Scripts, App Bundle Resources, Product Website, Project Root). Quality
  loss is negligible because there's nothing for the LLM to analyze in
  these zones beyond "which directory is this in" — the previous LLM
  output was effectively the same templated paraphrase.

  **Use Haiku for pass 1 (naming-dominant), Sonnet for pass 2+.** Pass 1's
  job is mostly zone naming + initial observations; Haiku does that
  accurately in roughly 1/3 the wall-clock of Sonnet and at a fraction of
  the cost. Pass 2+ (cross-zone relationships, anti-patterns, suggestions)
  stays on the standard model so analytical quality doesn't regress.
  Respects `claude.lightModel` / `codex.lightModel` overrides in
  `.n-dx.json` for users who want to pin a specific cheap model.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Phase 0 of the context-graph rework: introduces three foundational primitives
  that downstream finding/zone consumers will gate on.

  - `Zone.evidenceSources?` (imports / proximity / declared / pinned) and
    `Zone.confidence?` so consumers can distinguish import-graph-backed zones
    from proximity-only fallbacks.
  - `Finding.anchors?` (file/line/symbol coordinates) and `Finding.confidence?`
    so unverified hypotheses can be filtered before reaching the user.
  - New `.sourcevision/project-profile.json` (`ProjectProfile` type) capturing
    primary language, detected frameworks (SwiftUI, AppKit, React, …),
    release infrastructure (release-please, changesets, Cargo, pyproject,
    git-tag build scripts), build and CI surfaces, and import-graph quality.

  No behavior changes yet — schema fields are optional and the profile file is
  emitted but not yet consumed by the finding prompt. Subsequent commits gate
  structural findings on `importGraphQuality` and suppress recommendations
  that contradict detected release infrastructure.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Zone clustering now uses an explicit edge-weight model. `ImportEdge` gained an
  optional `weight` field; Louvain prefers it when set (falling back to
  `symbols.length` for any resolver that hasn't opted in). The Swift resolver
  now reports raw reference counts (a file that references `AppEnvironment` 20
  times is structurally more coupled than one that mentions it once), with each
  edge capped at weight 10 so a single hot edge can't dominate zone assignment.
  Net effect on Swift codebases: composition-root files cluster with the layer
  that uses them heavily, not with the layer whose types they happen to
  import.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Make `sv analyze` (and especially `--full`) substantially faster.

  - **Parallel enrichment batches.** Previously batches inside a single
    enrichment pass ran sequentially because each fed an `enrichedNames` hint
    forward to the next. That hint was advisory (collisions are resolved
    post-hoc), so batches now run via `Promise.allSettled`. On a typical
    7-zone repo this roughly halves Phase 4 wall-clock per pass.
  - **Early-exit `--full` on convergence.** The pass loop now fingerprints
    zone identity + finding/insight counts after each pass and stops as soon
    as a pass produces no observable change. Stable codebases routinely run
    4 passes today where 1–2 do all the real work; the rest were dead weight.
  - **`ZONES_PER_BATCH` 5 → 7.** Lets the typical small-to-medium project run
    in a single batch instead of two.
  - **Tightened file-header excerpts.** Per-file cap 800 → 400 chars,
    per-batch budget 6 KB → 2.5 KB. Headers are still useful as ground-truth
    for "is this documented", but the previous budget inflated the full
    prompt enough to consistently miss the 90 s per-call timeout on slower
    networks.
  - **Per-call timeout configurable + default bumped.** `claude` CLI
    invocations now default to 120 s (was 90 s) and respect
    `NDX_CLAUDE_PER_CALL_TIMEOUT_MS=<ms>` for users on slow networks /
    larger prompts. The 90 s cap was killing many legitimate-but-slow
    full-prompt completions before first byte (claude buffers stdout fully,
    so partial progress is invisible).

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Stop fabricating findings against documented files. The enrichment prompt now
  includes each batched file's leading doc-comment block as an authoritative
  header excerpt (TS/JS/Swift/Rust/Python/Go/HTML/MD comment conventions are
  recognized). The LLM is explicitly told not to call a documented file
  "undocumented".

  Adds a defensive backstop that drops findings whose text begins with a
  hypothesis ("If X then…", "Should/Might/May/Could/Possibly/Perhaps…",
  "It may/might/could/appears/seems…"). Dropped findings are logged with a
  single-line count so the user knows what was filtered. The prompt guard
  already discouraged these; this filter catches the leaks.

  Also marks `projectDir` as in-memory-only on `ProjectProfile` so the
  on-disk `.sourcevision/project-profile.json` stays portable across machines.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Extend the reference-count edge-weight model to JS/TS imports. The resolver
  now counts how many times each named-import binding actually appears in the
  file body (after the import statement itself) and uses that as the edge
  weight, capped at 10. Same hub-attraction problem the Swift resolver had: a
  file that imports `cheap-helper` and uses it once shouldn't drag toward
  `cheap-helper`'s zone as hard as a file that uses it 30 times. Wildcard and
  default imports keep the baseline weight 1 because there's no parseable
  local alias to count.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Feed the detected project profile into the LLM finding prompt with hard
  constraints that suppress recommendations that don't fit the project's shape:

  - When `importGraphQuality` is `sparse` or `absent` (e.g. a Swift, Rust, or
    Python project with no resolvable JS/TS imports), the LLM is told NOT to
    emit structural findings — those zones come from file-tree proximity and
    can't carry meaningful coupling/cohesion claims.
  - When the repo already has release infrastructure (release-please,
    changesets, package.json, Cargo, pyproject, git-tag build scripts), the LLM
    is told NOT to recommend introducing a VERSION file or competing release
    scheme.
  - When SwiftUI is detected as a framework, the LLM is told not to recommend
    MVVM coordinator/view-model transplants or protocols-for-testability by
    default.
  - When the primary language is anything other than TS/JS, the LLM is told not
    to propose JS/TS-specific patterns (e.g. Combine `.replaceError` on a sink
    whose `Failure` is `Never`).
  - Conditional "If X then Y" findings must be confirmed and rewritten as facts
    or omitted.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Add a Swift import + symbol-reference resolver so sourcevision produces a real
  file→file graph on Swift codebases instead of falling back to proximity-only
  zone detection. Swift's `import X` references modules, not files, so a literal
  import parser would produce zero internal edges — this resolver does two
  passes: (1) external `import X` for framework detection (Foundation, SwiftUI,
  AppKit, etc., classified against an Apple stdlib list), and (2) a project-wide
  declaration index (`class/struct/enum/protocol/actor/extension/typealias`)
  plus a reference scan that emits an internal edge for each project-declared
  symbol used in another file. Comments and string literals are stripped before
  both passes so doc-comment mentions don't produce phantom edges.

  The result is that `importGraphQuality` flips from `"absent"` to `"rich"` on a
  typical SwiftUI app — Louvain produces meaningful zones with real cohesion,
  and the prompt-side gating no longer needs to suppress every structural
  finding on the project.

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Register Swift as a first-class language in the language registry so `.swift`
  files are actually discovered and reach the Swift import resolver. Without
  this, `Package.swift` / `.xcodeproj` projects were being treated as TypeScript
  fallback — `.swift` was filtered out of `parseableExtensions` before phase 2
  ran, leaving the import graph empty even though the Swift resolver was wired
  in. Adds the `swiftConfig` (extensions, test/generated patterns, build/skip
  directories, `Package.swift` as module file), wires it through
  `detectLanguage` / `detectLanguages`, and adds Swift to `VALID_LANGUAGE_IDS`.
  Tiebreak preference on tied counts: TypeScript > Swift > Go (preserves the
  legacy "TS wins go.mod+package.json tie" behavior).

- [#224](https://github.com/en-dash-consulting/n-dx/pull/224) [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8) Thanks [@dnaniel](https://github.com/dnaniel)! - Two complementary partitioning fixes that target the "29-file blob with three
  concerns glued together" failure mode on small/medium repos.

  **A. Quarantine out-of-package tests.** When a test file lives in a
  test-only directory (Swift `Tests/<suite>/...`, Vitest/Jest `tests/...`),
  strip it out of Louvain entirely and drop it into its own per-suite
  `tests-<suite>` zone. Tests routinely import production code heavily, which
  previously made Louvain glue the test to whatever it asserted against (a
  classic anti-pattern in the partition).

  Tests COLOCATED with their package (Go's `internal/foo/foo_test.go` next
  to `foo.go`) keep their existing behavior — they stay with the package
  because the directory they live in also contains production code, signaling
  "this test belongs here." Detection: a test directory is "test-only" iff
  no production file shares its directory.

  **B. Project-relative subdivision threshold.** `SUBDIVISION_THRESHOLD` was
  a flat 50 files, meaning a 29-file zone in a 111-file project (26 % of
  the codebase!) never got recursively subdivided. Now `max(12,
floor(totalFiles * 0.15))` — any zone over 15 % of the project triggers
  subdivision regardless of how high its measured cohesion is, because high
  cohesion at large size usually means "many concerns connected by shared
  vocabulary," not "one tight thing."

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

- Updated dependencies [[`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`29bd146`](https://github.com/en-dash-consulting/n-dx/commit/29bd14608135ee9b0ae1168f77226113436da67a), [`aca6ede`](https://github.com/en-dash-consulting/n-dx/commit/aca6ede08e1182b5307a27e17ee320a33066b8a8)]:
  - @n-dx/llm-client@0.4.2

## 0.4.1

### Patch Changes

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

- [#189](https://github.com/en-dash-consulting/n-dx/pull/189) [`907c5fe`](https://github.com/en-dash-consulting/n-dx/commit/907c5fe8ace0139ab44f323f6a411ed35abb1363) Thanks [@dnaniel](https://github.com/dnaniel)! - Refresh the SourceVision Map experience with cohesive zone/import exploration, remove obsolete Zones navigation, gate PR Markdown behind a feature flag, and dedupe promoted sub-analysis zones.

- [#174](https://github.com/en-dash-consulting/n-dx/pull/174) [`9237f50`](https://github.com/en-dash-consulting/n-dx/commit/9237f509d505659f134f52a9effa6a4f9666fe48) Thanks [@dnaniel](https://github.com/dnaniel)! - Add sourcevision LLM eval harness under `tests/gauntlet/sourcevision-evals/` with fixture projects, golden recording pipeline (`pnpm gauntlet:evals:record`), and gated scoring tests (`pnpm gauntlet:evals`). Enables measured eval-score deltas on future optimization PRs (model swaps, payload reduction, heuristic-first classification).

- Updated dependencies []:
  - @n-dx/llm-client@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @n-dx/llm-client@0.3.1

## 0.3.0

### Patch Changes

- [#167](https://github.com/en-dash-consulting/n-dx/pull/167) [`9ce5ee5`](https://github.com/en-dash-consulting/n-dx/commit/9ce5ee50f9c2a8f90099f2a0fed17475441d55c7) Thanks [@endash-shal](https://github.com/endash-shal)! - more documentation additions and sourcevision token optimizations

- [#165](https://github.com/en-dash-consulting/n-dx/pull/165) [`60c684e`](https://github.com/en-dash-consulting/n-dx/commit/60c684e42a97f12c22ee83a0ad299ade64c57589) Thanks [@endash-shal](https://github.com/endash-shal)! - Added more documentation, small fixes and increased base timeout

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

- Updated dependencies []:
  - @n-dx/llm-client@0.1.8
