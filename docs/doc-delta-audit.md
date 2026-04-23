# Documentation Delta Audit — Past 7 Days

Date: 2026-04-22
Auditor: hench agent
Scope: merges and feature-branch commits within `git log --since='7 days ago'` on
`main` and every local feature branch.

## 1. Inputs

### 1.1 Merges to `main`

| SHA | Date | PR | Title |
|-----|------|----|-------|
| `04c8310e` | 2026-04-16 | #168 | Feature/self-heal improvements |
| `c6acdf3f` | 2026-04-17 | #171 | chore: version packages |
| `c1e1f5f1` | 2026-04-18 | #172 | Fix/core files assistant integration |
| `17690a7e` | 2026-04-18 | #173 | chore: version packages |
| `0269cf75` | 2026-04-21 | #170 | add single command, "pair programming", and more! |
| `c2b7f84e` | 2026-04-22 | #177 | Fix Codex CLI and test suite on Windows |
| `76bfdd76` | 2026-04-22 | #175 | Fix/api-versus-cli-distinction |

### 1.2 Unmerged feature-branch commits referenced in the task brief

All on `feature/new-PRD-design`, in commit-time order:

| SHA | Title |
|-----|-------|
| `8fac6918` | Add branch-aware PRD file naming utilities |
| `50f62673` | Add PRD file discovery and selection for branch-scoped management |
| `11014848` | Aggregate items from all `prd_*.json` files in PRDStore read operations |
| `340a8a26` | Route PRDStore write operations to owning PRD file |
| `f56e347c` | Implement automatic migration from single `prd.json` to branch-scoped multi-file format |
| `7c656839` | Validate CLI, MCP, and web dashboard against multi-file PRD backend |
| `ca134f3a` | Implement cross-PRD duplicate detection with older-file preference |
| `abed6ef4` | Wire branch-scoped PRD file targeting into `rex add` and `ndx add` pipelines |
| `9e1daa2f` | **Consolidate branch-scoped PRD files into single `prd.json`** (reverts the above) |
| `4bdb1d43` | Add legacy multi-file PRD migration fixture and test |

**Net behavioral effect:** the branch currently ships a single-file `.rex/prd.json` **with a one-time on-load migration** that merges any legacy `prd_{branch}_{date}.json` files into it and renames the originals to `<name>.backup.<timestamp>`. The branch-scoped, cross-PRD, and multi-file-validation work is not a user-visible feature — it exists only as a migration path into the unified layout.

## 2. Change categorization

Each row is classified by the documentation surface it touches. Categories:

- **PRD** — `.rex/prd.json` shape, PRD storage layout, rex domain semantics.
- **CLI** — `ndx`/`rex`/`hench`/`sv` command surface, flags, help text.
- **MCP** — Rex/sourcevision MCP tool list, transport, schemas.
- **ARCH** — Zone layout, gateway table, package-guidelines, testing policy.
- **OPS** — Config keys, hooks, security, Windows/Docker operational notes.

| SHA | Category | Short description |
|-----|----------|-------------------|
| `04c8310e` (#168) | CLI, OPS | Self-heal test gate, `--skip-deps` flag, dependency audit step, cleanup transformations, rate-limit retry, rollback on failure. |
| `c1e1f5f1` (#172) | — | `package.json` `files` array fix; no user-visible surface change. |
| `c6acdf3f`, `17690a7e` | — | Changeset version bumps; no doc delta. |
| `0269cf75` (#170) | CLI, MCP, ARCH, OPS | New `ndx single-command`/`sc` + `ndx pair-programming`/`bicker` entry points; MCP HTTP schema hot-reload watcher; `cli.timeoutMs` / `cli.timeouts.*` config keys; hench pre-commit approval via `.hench-commit-msg.txt` + `hench.autoCommit` opt-in; two-stage Ctrl+C in `ndx work`; rate-limit retry-after progress and exhaustion error; dashboard settings UI (LLM provider, project settings) and CLI command triggers; internal zone moves (polling engine, loader/schema sub-zones, hench barrel pruning, rex `fix.ts` relocation, view-routing extraction to `web-shared`). |
| `c2b7f84e` (#177) | OPS | Windows compatibility: CRLF normalization, path-separator handling, shell-quoting for Codex CLI spawn; architecture-policy zone exceptions adjusted. |
| `76bfdd76` (#175) | CLI, OPS | Cross-vendor regression coverage for rex authoring, Codex batch pipeline vendor-awareness, rate-limit classifier wired through reshape/reorganize/prune/analyze, per-tier `lightModel` override. |
| `8fac6918` → `abed6ef4` | PRD | Branch-scoped multi-file PRD implementation (superseded). |
| `7c656839` | PRD, CLI, MCP | Validated multi-file PRD across CLI, MCP, dashboard (superseded). |
| `ca134f3a` | PRD | Cross-PRD duplicate detection (superseded). |
| `f56e347c` | PRD | Single→multi migration (superseded). |
| `9e1daa2f` | PRD | Collapsed multi-file layout back to single `prd.json`; introduced legacy-file consolidation migration; removed `prd-discovery.ts`, ownership map, nested locks, `setCurrentBranchFile`. |
| `4bdb1d43` | — (tests only) | Fixture + test for legacy multi-file → single-file migration; no user-visible behavior. |

## 3. Delta mapping (per documentation file)

Each subsection lists **required** edits only. Files with zero required edits appear in §4.

### 3.1 `README.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | Add `ndx single-command` / `sc` and `ndx pair-programming` / `bicker` to the §Commands "More" table and to the `ndx --help`-style listing. One-line descriptions. |
| `0269cf75` | Update §7 Monitor / §Quick Start if we want to call out that `ndx start` now hot-reloads MCP tool schemas after a `pnpm build` — optional, nice-to-have. |
| `0269cf75` | §Security: note that hench now prompts for commit approval by default (`.hench-commit-msg.txt` handoff); opt-in auto-commit is `hench.autoCommit`. |
| `0269cf75` | §Commands: `ndx config` now exposes `cli.timeoutMs` and `cli.timeouts.<command>` — mention in the `--help` blurb or link. |
| `04c8310e` | §6 Self-Heal: mention the mandatory test gate and optional `--skip-deps` dependency audit step. |
| `9e1daa2f` + `4bdb1d43` | §Output Files: `.rex/` row is already `prd.json`-only, so no cell change. Add a single sentence near the PRD description noting that legacy `prd_{branch}_{date}.json` files are auto-merged on first load and renamed to `.backup.<timestamp>`. |
| `76bfdd76` | No user-facing change — fully absorbed by existing self-heal / rate-limit language. |
| `c2b7f84e` | §Platform Support Windows-native row is already "Experimental" — no rewrite required; the concrete fixes land under-the-hood. |

### 3.2 `CLAUDE.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | §n-dx Orchestration Commands block: add `ndx single-command "description"` / `sc` and `ndx pair-programming`/`bicker` entries with one-line syntax. |
| `0269cf75` | §Rex MCP tools and §Sourcevision MCP tools: verify against current `registerMcp*Tools` exports; no new tools landed in these PRs, so this is a **verification step** only, not a mandated edit. |
| `0269cf75` | §Gateway modules / §Concurrency contract: cross-check `packages/web/src/server/routes-commands.ts`, `routes-llm.ts`, `routes-project-settings.ts`, `mcp-schema-watcher.ts`, `mcp-subprocess-proxy.ts`. None of them add cross-package imports, so the gateway table is unchanged. The MCP hot-reload watcher merits a one-liner under §HTTP-request concurrency ("schema changes are picked up by new sessions; existing sessions keep the previously-bound schema"). |
| `0269cf75` | §Key Files: add `.hench-commit-msg.txt` (proposed commit message, consumed by orchestrator `git commit -F` on approval). |
| `0269cf75` | §Web server zone stability / §web-viewer hub: the polling-engine sub-zone, loader schema sub-zone, and `use-polling` relocation are already reflected by recent commits; confirm zone pins in `.n-dx.json` still match and remove any stale pin notes that referred to `hooks/use-polling.ts`. |
| `0269cf75` | §Injection seam registry: verify `register-scheduler.ts` row is still accurate after the schema-watcher work added `mcp-schema-watcher.ts` / `mcp-subprocess-proxy.ts` — neither introduces a new injection seam, so **no row change**. Note for future editors. |
| `0269cf75` | Add a §CLI timeouts config paragraph or extend the existing config pointer to cover `cli.timeoutMs` and the `cli.timeouts.*` wildcard (default 1,800,000 ms; `work`/`self-heal` 4h; `start`/`web`/`dev` no timeout). |
| `04c8310e` | Add `TestGateResult` / dependency-audit pipeline as part of the Self-Heal mentions in §n-dx Orchestration Commands block (one-line annotation). |
| `0269cf75` + `04c8310e` | §Concurrency contract: add `ndx pair-programming`/`sc` rows to the compatibility matrix if they write to the PRD. `sc` ultimately spawns hench and creates a temp task, so it conflicts with other PRD writers — mark ❌ against `ndx plan`/`ci`/`work`. `pair-programming` runs `hench` + Codex review and is single-writer within the command. |
| `9e1daa2f` + `4bdb1d43` | §Key Files: `.rex/prd.json` row is correct. Add a one-line row or note that `.rex/prd_*.json.backup.<timestamp>` files may appear after first-time migration from a legacy multi-file layout. |
| `9e1daa2f` | `assistant-assets/project-guidance.md` (the upstream source) also needs the legacy-migration sentence; CLAUDE.md derives from it. Any edit to CLAUDE.md's §Packages or §Key Files must be mirrored there — otherwise `ndx init` will overwrite on regeneration. |

### 3.3 `AGENTS.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | Add `ndx single-command` / `sc` and `ndx pair-programming` / `bicker` to the §n-dx Orchestration Commands block. Because this file is generated from `project-guidance.md`, the edit goes there and AGENTS.md is regenerated by `ndx init`. |
| `0269cf75` | §Available Skills list is out of date vs. the live skill inventory (`triage`, `dev-link`, `init`, `review`, `security-review` are installed but unlisted). Regenerate via `ndx init` or patch manually; not strictly caused by the 7-day window — flag as pre-existing drift discovered during this audit. |
| `9e1daa2f` | §Key Files: mirror the legacy-migration note from CLAUDE.md (single-sentence addition, via `project-guidance.md`). |
| `04c8310e` | §Rex commands list: `rex prune`, `rex reshape`, `rex reorganize`, `rex fix` are not in the list. These commands exist and were exercised by #168. Flag as drift caught during this audit (not a new-this-week omission, but the self-heal work touched each of them). |

### 3.4 `PACKAGE_GUIDELINES.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | §Gateway table: no new cross-package imports introduced. Verify the existing `web → rex-gateway` / `web → domain-gateway` rows still match after the new `routes-commands.ts` / `routes-llm.ts` / `routes-project-settings.ts` additions. **No row change expected**, but confirm during the next pass. |
| `76bfdd76` + `0269cf75` | §Intentional type duplication: `rex-domain.ts` in web is still the canonical duplicated-types surface. No edit required. |

See §4 for the explicit "no changes required" statement when verification confirms the status quo.

### 3.5 `TESTING.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | §Required Tests / §Integration Test Tier: the new `tests/integration/pair-programming.test.js` (1,110 lines) is a cross-package contract test that touches core + hench + llm-client. Decide whether to list it under §Required tests (it is the sole cross-vendor-review regression) or leave it as a generic integration test. Either way, add one row to the package integration table under web/hench if we want guarantees. |
| `04c8310e` | §Required Tests: the self-heal `tests/integration/test-gate.test.ts` and `tests/integration/self-heal-codex-batch.test.ts` are the new regression surface for the mandatory test gate. Add as required integration scenarios under hench. |
| `76bfdd76` | §Required Tests: `packages/rex/tests/integration/vendor-regression.test.ts` (461 lines) pins cross-vendor behavior for rex authoring commands. Add as a required integration scenario under rex. |
| `9e1daa2f` + `4bdb1d43` | §Required Tests: `packages/rex/tests/unit/store/prd-migration.test.ts` is the migration regression. Consider adding to required unit scenarios under rex (currently the required-tests list is terse, so this may be optional). |

### 3.6 Per-package READMEs

#### `packages/rex/README.md`

| Source | Required change |
|--------|-----------------|
| `9e1daa2f` + `4bdb1d43` | Add a "PRD file layout" note near §File layout (line ~250): the single canonical file is `.rex/prd.json`. On first store resolution, legacy `prd_{branch}_{date}.json` files are merged into it and renamed to `<name>.backup.<timestamp>`. No user action required. |
| `9e1daa2f` | Smart-add duplicate-handling section (line ~53): remove any mention of `sourceFile` / `Target file` / per-file preference if present (none appears in the current README, so this is a **verification** step). |
| `76bfdd76` | Smart-add section: note that smart-add now resolves the active light-tier model (`lightModel` override) and surfaces the active model tier in the vendor header output. One-sentence addition. |
| `04c8310e` | No user-facing rex change. |

#### `packages/hench/README.md`

| Source | Required change |
|--------|-----------------|
| `96537d72` (in #170 squash) | Add "Commit approval" section: hench stages changes and writes a proposed message to `.hench-commit-msg.txt`; orchestrator prompts the user to accept before `git commit -F`. Opt-in auto-commit via `hench.autoCommit: true`. |
| `eeb41ff4` (in #170) | Add "Rollback on failure" / `--no-rollback` flag to the `hench run` / `ndx work` section. `rollbackOnFailure` config key. |
| `04c8310e` | Add "Test gate" paragraph: in self-heal mode, finalizeRun runs the full workspace test suite after any file change; failure sets `run.status = "failed"` to drive remediation. Also mention `--skip-deps` for dependency audit step. |
| `bf8b4722` | Add "Two-stage Ctrl+C" behavior to `ndx work` runtime behavior — first SIGINT stops hench and prompts to revert; second SIGINT force-exits without revert. |

#### `packages/llm-client/README.md`

| Source | Required change |
|--------|-----------------|
| `e961bb33` / `a97b4df7` | Document rate-limit retry UX: `onRetry` callback, default stderr "Rate limited — retrying in Xs… (attempt N of M)" message, and the actionable `ClaudeClientError` thrown after retry exhaustion. |
| `04c8310e` | Add `lightModel` (per-tier override) to the LLMConfig schema reference if the README enumerates config fields. |
| `c2b7f84e` | Windows Codex spawn fix is internal; no doc edit. |

#### `packages/web/README.md`

| Source | Required change |
|--------|-----------------|
| `0269cf75` | Document the new dashboard views: "Commands" (CLI command triggers → `/api/commands/*`), "LLM Provider" settings, and "Project Settings" — one paragraph each or a single bullet list. |
| `0269cf75` | Document MCP schema hot-reload on the HTTP transport: new sessions spawn a fresh subprocess per-session and pick up updated tool schemas after `pnpm build`; existing sessions stay pinned to their original schema. |
| `0269cf75` | Update §zone layering diagram if it still references the flat loader (it now has `loader/schema/` sub-zone and `polling/engine/` sub-zone). |

#### `packages/sourcevision/README.md`

No required changes — the 7-day window touched sourcevision only through `analyze` model-resolution plumbing and the `llms-txt` analyzer trim. These are internal.

#### `packages/core/` — no README; `assistant-assets/project-guidance.md` is the shared source

| Source | Required change |
|--------|-----------------|
| `0269cf75` | Add `ndx single-command`, `sc`, `ndx pair-programming`, `bicker` to the commands block. Both AGENTS.md and CLAUDE.md regenerate from here — do **not** hand-edit those files for this change; edit the asset and run `ndx init`. |
| `9e1daa2f` + `4bdb1d43` | Add the one-sentence legacy-migration note to the §Key Files / `.rex/prd.json` block. |

## 4. Files with zero required changes

Explicitly skip the following during the follow-up docs sweep — the 7-day commit window produced no changes their content needs to reflect:

| File | Reason |
|------|--------|
| `CODE_OF_CONDUCT.md` | Community policy; unaffected. |
| `ENFORCEMENT.md` | Policy-enforcement map; no new enforcement landed. |
| `RELEASING.md` | Changeset workflow unchanged. |
| `CONTRIBUTING.md` | Bootstrap and prerequisites unchanged (platform matrix already added in prior week). |
| `prd.md` | Product brief; no scope change. |
| `ZONES.md` | Zone-name catalog; Louvain reshuffling occurred inside the week (polling/engine, loader/schema, hench barrel removal, `use-polling` move) but every affected zone was **already listed** — verify names still match after `ndx analyze`, no proactive edit required. |
| `packages/sourcevision/README.md` | No sourcevision-facing behavior change in the window. |
| `docs/cli-hint-audit.md` | Existing audit artifact; scope does not include hint verification for new commands (track separately). |
| `docs/cli-ui-gap.md` | Already cites `ndx pair-programming` / `bicker` as P3 dashboard-coverage item (line 45); new dashboard views from #170 close some P3 entries — follow-up PR should **amend** cli-ui-gap.md, but the 7-day audit is not the right vehicle. |
| `docs/config-schema-ui-gap.md` | Already tracks `tokenBudget`/`selfHeal` keys; the new `cli.timeoutMs` / `cli.timeouts.*` keys were added by `a6992b55` and should be appended to this file in a follow-up — noted but out of scope for the delta report itself. |
| `docs/architecture/*` | Architecture deep-dives; internal zone reshuffles (#170) are cosmetic and do not invalidate published architectural arguments. |
| `docs/process/*` | Historical process docs; unaffected. |
| `docs/guide/*` | User guides; re-verify next week, but no feature in the window requires a guide rewrite. `docs/guide/vibe-cleanup.md` correctly cites `ndx self-heal` semantics. |
| `packages/*/CHANGELOG.md` | Generated by changesets on release; not hand-edited. |
| Package-internal README files under `packages/*/tests/*/README.md` | Test-suite catalogs; new tests discussed in §3.5 above are additions, not doc-structure changes. |

## 5. Follow-up work (out of scope for this audit)

These items surfaced while auditing but belong to the rest of the "Documentation Refresh" epic, not this task:

- Add `cli.timeoutMs` and `cli.timeouts.*` to `docs/config-schema-ui-gap.md`.
- Close P3 rows in `docs/cli-ui-gap.md` that the new dashboard settings/commands views address.
- Regenerate `AGENTS.md` skill list via `ndx init` after the `assistant-assets/` edits land.
- Re-run the CLI hint audit (`docs/cli-hint-audit.md`) to cover `ndx single-command` and `ndx pair-programming` error paths.
- Confirm zone-pin entries in `.n-dx.json` still reference live zones after the polling/loader sub-zone moves (no action expected — structural pin audit only).

## 6. Summary

- **7 PR merges** to main + **10 in-progress commits** on `feature/new-PRD-design`.
- Biggest doc surface is #170 (`0269cf75`) — touches CLI, MCP, dashboard UI, config keys, and hench commit workflow.
- The entire "branch-scoped / cross-PRD / multi-file" track collapsed into a single on-load migration; user-facing docs only need a **one-sentence legacy-migration note** in `README.md` / `CLAUDE.md` / `AGENTS.md` (via `project-guidance.md`) and `packages/rex/README.md`. The rest of that track is internal-only.
- `PACKAGE_GUIDELINES.md`, `CODE_OF_CONDUCT.md`, `ENFORCEMENT.md`, `RELEASING.md`, `CONTRIBUTING.md`, `prd.md`, `ZONES.md`, and `packages/sourcevision/README.md` require **no changes** from the 7-day window.
