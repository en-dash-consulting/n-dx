# Phase 1 Audit & Phase 2 Risk Assessment

**Date:** 2026-04-01
**Branch:** `feature/codex-integration-enhancements`
**Purpose:** Catalogue exactly what Phase 1 changed, confirm the Claude execution path is intact, and assess the risk that Phase 2 (vendor normalization) introduces regressions to working functionality.

---

## 1. Phase 1 Scope of Changes

### 1.1 File change summary

| Category | Files | New | Modified | Lines added |
|----------|-------|-----|----------|-------------|
| Foundation (`llm-client`) | 4 | 1 | 3 | ~860 |
| Execution (`hench`) | 4 | 0 | 4 | ~530 |
| Orchestration (`core`) | 5 | 2 | 3 | ~540 |
| Canonical assets | 5 | 5 | 0 | ~1,210 |
| Tests | 12 | 12 | 4 | ~5,400 |
| Documentation | 2 | 2 | 0 | ~770 |

### 1.2 New files (zero risk to existing functionality)

These files did not exist on `main`. They cannot have regressed anything:

```
assistant-assets/index.js                              # Vendor-neutral render contract
assistant-assets/manifest.json                         # Skill & MCP server manifest
assistant-assets/project-guidance.md                   # Shared instruction source
assistant-assets/claude-addendum.md                    # Claude-specific addendum
assistant-assets/codex-troubleshooting.md              # Codex troubleshooting guide
packages/core/assistant-integration.js                 # Vendor registry dispatcher
packages/core/codex-integration.js                     # Codex-specific init setup
packages/llm-client/src/runtime-contract.ts            # Shared contract types
docs/analysis/claude-codex-runtime-identity-discovery.md
docs/process/codex-transport-artifact-decisions.md
```

All 12 new test files are also in this category.

### 1.3 Modified files that touch the Claude execution path

| File | What changed | Claude path impact |
|------|-------------|-------------------|
| `packages/core/cli.js` | Added assistant-selection flag parsing (`--no-claude`, `--codex-only`, `--assistants=`) and backward-compat re-init detection | **Init-time only.** Existing Claude-only projects auto-detected and re-provisioned as Claude-only. Runtime execution untouched. |
| `packages/core/claude-integration.js` | Skill content now sourced from `assistant-assets/manifest.json` instead of inline `SKILLS` dict. Delegates to `writeVendorSkills("claude", dir)`. | **Functionally identical output.** Same CLAUDE.md, same `.claude/skills/` files. Source location changed, content preserved. |

### 1.4 Modified files in the execution layer

| File | What changed | Claude path impact |
|------|-------------|-------------------|
| `packages/hench/src/agent/lifecycle/cli-loop.ts` | +366 lines: added `processCodexJsonLine()`, `normalizeCodexResponse()`, `compileCodexPolicyFlags()`, updated `spawnCodex()` to accept `ExecutionPolicy`, added `dispatchVendorSpawn()` | **`spawnClaude()` untouched.** `buildClaudeCliArgs()` untouched. Claude stream-json parsing untouched. New code is Codex-only and gated behind `vendor === "codex"` check. |
| `packages/hench/src/agent/lifecycle/token-usage.ts` | Codex token mapping moved from local implementation to `@n-dx/llm-client` re-export. Added diagnostic-aware variants. | **Claude token parsing unchanged.** `parseApiTokenUsage()` and `parseStreamTokenUsage()` have identical signatures and behavior. New `*WithDiagnostic` variants are additive. |
| `packages/hench/src/prd/llm-gateway.ts` | +36 new re-exports from `@n-dx/llm-client` (runtime-contract types, policy compilation, diagnostics) | **Gateway pattern preserved.** Existing re-exports untouched. New exports are additive. |
| `packages/hench/src/cli/errors.ts` | +75 lines: vendor-neutral failure classification using `classifyVendorError()` from runtime-contract | **Additive.** Existing error handling preserved. New classification layered on top. |

### 1.5 Explicitly unchanged critical files

These files are confirmed **identical to `main`**:

```
✅ packages/hench/src/agent/lifecycle/loop.ts        # Claude API execution loop
✅ packages/hench/src/agent/lifecycle/shared.ts       # Shared lifecycle (both providers)
✅ packages/hench/src/agent/planning/prompt.ts        # System prompt construction
✅ packages/hench/src/agent/planning/brief.ts         # Task brief assembly
✅ packages/hench/src/validation/completion.ts        # Completion validation
✅ packages/hench/src/tools/dispatch.ts               # Tool definitions & dispatch
✅ packages/hench/src/store/project-config.ts         # Vendor config resolution
✅ packages/hench/src/schema/v1.ts                    # Run record schema (extended only)
```

---

## 2. Claude Execution Path Integrity

### 2.1 API execution path (`loop.ts`)

**Status: Completely untouched.**

The entire API loop — Anthropic SDK calls, tool-use conversation management, message pruning, retry logic — is byte-for-byte identical to `main`.

### 2.2 CLI execution path (`cli-loop.ts`)

**Status: Extended, not modified.**

The Claude-specific functions within cli-loop.ts are unchanged:

| Function | Status | Notes |
|----------|--------|-------|
| `buildClaudeCliArgs()` | Unchanged | Builds `--output-format stream-json`, `--allowed-tools`, etc. |
| `spawnClaude()` | Unchanged | Spawns `claude` binary with args and stdin |
| `processStreamLine()` | Unchanged | Parses Claude's stream-json events |
| `cliLoop()` | Extended | Now passes `ExecutionPolicy` to `dispatchVendorSpawn()`, but the policy is only consumed by `spawnCodex()`. Claude path receives and ignores it. |

The new `dispatchVendorSpawn()` function is a thin router:

```typescript
if (opts.vendor === "codex") {
  return spawnCodex(/* codex-specific args */);
}
// Falls through to Claude path — identical to previous direct call
return spawnClaude(args, stdinContent, projectDir, ...);
```

### 2.3 Shared lifecycle (`shared.ts`)

**Status: Completely untouched.**

All lifecycle operations that both providers depend on are identical:

- `prepareBrief()` — task brief assembly
- `transitionToInProgress()` — PRD status update
- `initRunRecord()` — run record creation
- `runReviewGate()` — diff review and approval
- `runPostTaskTestsIfNeeded()` — post-task test execution
- `finalizeRun()` — summary generation, stats, completion
- `handleRunFailure()` — error handling
- `handleBudgetExceeded()` — budget enforcement

### 2.4 Prompt construction

**Status: Completely untouched.**

`buildSystemPrompt()` in `planning/prompt.ts` still produces the same system prompt for both providers. The provider-specific rule injection (`isCli` flag) is unchanged.

### 2.5 Tool dispatch

**Status: Completely untouched.**

`TOOL_DEFINITIONS` array and `dispatchTool()` function are identical to `main`. Tool definitions remain in Anthropic SDK format.

### 2.6 Completion validation

**Status: Completely untouched.**

`validateCompletion()` checks git diff, test results, and self-heal mode identically for both providers.

---

## 3. Test Coverage Protecting the Claude Path

### 3.1 Existing tests (from `main`) that still pass

All pre-existing tests in the following suites remain green and unmodified:

- `packages/hench/tests/unit/` — Claude API/CLI unit tests
- `packages/llm-client/tests/unit/` — provider, auth, token parsing tests
- `tests/e2e/cli-init.test.js` — init flow (extended with new cases, originals preserved)
- `tests/e2e/cli-ci.test.js` — CI pipeline tests
- `tests/e2e/architecture-policy.test.js` — tier boundary enforcement
- `tests/e2e/domain-isolation.test.js` — gateway pattern enforcement

### 3.2 New tests added by Phase 1

| Test file | Lines | What it protects |
|-----------|-------|-----------------|
| `packages/llm-client/tests/unit/runtime-contract.test.ts` | 628 | Prompt envelope assembly, execution policy compilation, failure classification |
| `packages/hench/tests/unit/agent/cross-vendor-parity.test.ts` | 470 | Both vendors receive identical prompt sections, policies, event schemas |
| `packages/hench/tests/unit/agent/codex-structured-events.test.ts` | 417 | Codex JSONL parsing, tool blocks, token extraction |
| `packages/llm-client/tests/unit/token-usage.test.ts` | 468 | Token parsing from both API and CLI formats |
| `tests/e2e/codex-mcp-contract.test.js` | 461 | Live MCP server spawn and tool registration |
| `tests/e2e/skill-sync.test.js` | 558 | Dual-vendor skill manifest sync |
| `tests/e2e/assistant-integration.test.js` | 467 | Vendor registry dispatch, enable/disable flags |
| `tests/e2e/codex-artifact-validation.test.js` | 469 | Path drift, missing skills, malformed MCP defs |
| `tests/e2e/instruction-alignment.test.js` | 279 | CLAUDE.md and AGENTS.md share same guidance sections |
| `tests/e2e/assistant-parity-smoke.test.js` | 314 | Help text, init output, startup output formatting |

### 3.3 Test coverage gaps

| Gap | Risk | Notes |
|-----|------|-------|
| No test spawns the Claude binary with mocked responses | Medium | cli-loop tests use dry-run mode only; no real `claude -p` execution is tested |
| No snapshot tests for Claude stream-json output format | Medium | A change to Claude CLI's output format would silently break parsing |
| No multi-turn token budget enforcement test | Medium | Per-payload parsing tested; cross-turn accumulation is not |
| No tool result injection roundtrip test | Low | Tool dispatch tested; re-serialization into next turn prompt is not |

---

## 4. Phase 2 Risk Assessment

### 4.1 What Phase 2 proposes to change

Phase 2 (`docs/architecture/phase2-vendor-normalization.md`) plans six epics:

1. **Vendor Adapter Extraction** — split cli-loop.ts into `ClaudeCliAdapter` + `CodexCliAdapter`
2. **Unified Event Pipeline** — replace ad hoc result shapes with `RuntimeEvent` streams
3. **Prompt Envelope Adoption** — use `PromptEnvelope` in prompt construction
4. **API Provider Generalization** — remove Claude-only gate from agentLoop()
5. **Run Diagnostics** — add `RuntimeDiagnostics` to run records
6. **Cross-Vendor Contract Tests** — codify identity baseline as automated tests

### 4.2 Risk matrix by epic

| Epic | Files touched | Claude path impact | Risk | Mitigation |
|------|--------------|-------------------|------|------------|
| **1. Adapter Extraction** | cli-loop.ts → split into 3 files | **HIGH — refactors the Claude execution path.** `buildClaudeCliArgs()`, `spawnClaude()`, `processStreamLine()` move to `ClaudeCliAdapter`. | **MODERATE** | Extract only; no logic changes. Existing E2E tests are the regression gate. Run full suite after each extraction step. |
| **2. Event Pipeline** | cli-loop.ts, shared.ts (possible), schema/v1.ts | **MEDIUM — changes the data shape flowing through the loop.** `CliRunResult` replaced by `RuntimeEvent[]` + `EventAccumulator`. | **MODERATE** | Keep `CliRunResult` as a compatibility bridge during migration. Add snapshot tests for both vendors' event output before refactoring. |
| **3. Prompt Envelope** | planning/prompt.ts, planning/brief.ts | **MEDIUM — changes how prompts are constructed.** String concatenation replaced by `PromptEnvelope` sections. | **LOW** | Output should be identical strings. Add regression test comparing old and new prompt output for same task before switching. |
| **4. API Generalization** | loop.ts | **HIGH — modifies the Claude API execution path.** Removes vendor check; introduces `ProviderRegistry` resolution. | **MODERATE** | Add integration test that verifies Claude API loop produces identical results before and after. Gate behind feature flag initially. |
| **5. Diagnostics** | schema/v1.ts, shared.ts, runs.ts | **LOW — additive schema change.** New optional `diagnostics` field on `RunRecord`. | **LOW** | Additive only. Existing run records without the field remain valid. |
| **6. Contract Tests** | Test files only | **NONE — read-only assertions.** | **NONE** | Pure validation. |

### 4.3 High-risk areas requiring explicit safeguards

#### Risk 1: Adapter extraction breaks Claude CLI spawn

**What could go wrong:** Moving `buildClaudeCliArgs()` and `spawnClaude()` into `ClaudeCliAdapter` introduces import path changes, argument ordering bugs, or context loss.

**Safeguard:**
- Write a snapshot test that captures the exact args array `buildClaudeCliArgs()` produces for a representative task *before* the extraction
- After extraction, assert the adapter produces byte-identical args
- Run `hench run --dry-run` with Claude vendor and diff output against pre-extraction baseline

#### Risk 2: Event pipeline breaks spin detection or budget checks

**What could go wrong:** Replacing `CliRunResult` accumulation with `EventAccumulator` could change how token totals are computed or how spin detection thresholds are evaluated.

**Safeguard:**
- Before refactoring, capture the `CliRunResult` and token totals from 3+ existing run records
- After refactoring, assert `EventAccumulator.toCliRunResult()` produces identical values
- Add explicit regression test: same events → same spin detection verdict → same budget verdict

#### Risk 3: Prompt envelope changes prompt content

**What could go wrong:** Switching from string concatenation to `PromptEnvelope` + `assemblePrompt()` could change whitespace, section ordering, or omit content.

**Safeguard:**
- Capture the exact system prompt and task prompt strings for 3+ representative tasks *before* the change
- After the change, assert byte-identical output
- Only then remove the old prompt code path

#### Risk 4: API generalization breaks Claude API loop

**What could go wrong:** Replacing the direct Anthropic SDK calls with `ProviderRegistry.getActiveProvider()` could change retry behavior, error classification, or message formatting.

**Safeguard:**
- This epic should be the last to execute (after adapters, events, and envelope are stable)
- Add integration test that runs the API loop with a mock Anthropic endpoint and captures the full conversation history
- Feature-flag the change: `config.useRegistryProvider: boolean` (default false initially)

### 4.4 Modules that must NOT be modified

The following modules are the stable anchor for both providers. Phase 2 should treat them as **read-only** unless there is an explicit, justified reason:

| Module | Reason |
|--------|--------|
| `shared.ts` | Both providers depend on every function. Changes cascade to all execution paths. |
| `completion.ts` | Completion validation is vendor-neutral by design. No reason to touch it. |
| `dispatch.ts` (tool definitions) | Tool format changes affect both providers simultaneously. Defer to Epic 4.3 only. |
| `brief.ts` | Task brief assembly is vendor-neutral. Envelope adoption (Epic 3) wraps its output, not replaces it. |

### 4.5 Modules that should be modified carefully

| Module | Phase 2 change | Caution |
|--------|---------------|---------|
| `cli-loop.ts` | Extract into adapters (Epic 1) | Most complex refactor. Do incrementally — extract one adapter at a time, run tests between each. |
| `prompt.ts` | Produce `PromptEnvelope` (Epic 3) | Must produce identical string output. Regression test required before and after. |
| `loop.ts` | Remove vendor gate (Epic 4) | Feature-flag the change. Do not remove the old code path until the new path is validated. |
| `schema/v1.ts` | Add `diagnostics` field (Epic 5) | Additive only. Never remove or rename existing fields. |

---

## 5. Backward Compatibility Guarantees

### 5.1 What users depend on today

| User-facing behavior | Status after Phase 1 | Phase 2 risk |
|---------------------|---------------------|--------------|
| `ndx init` provisions Claude by default | ✅ Preserved (dual-vendor, but Claude always included) | None |
| `ndx work` executes tasks with Claude CLI | ✅ Unchanged execution path | Adapter extraction must preserve identical `claude -p` invocation |
| `.hench/runs/*.json` format | ✅ Extended with optional fields only | Diagnostics field is additive; old records remain valid |
| `hench show <run>` output | ✅ Unchanged | New diagnostics display is additive |
| Token usage reporting | ✅ Claude parsing unchanged | Event pipeline must preserve identical token totals |
| MCP server registration | ✅ Claude MCP setup unchanged | Not in Phase 2 scope |

### 5.2 What must remain true after Phase 2

1. A project initialized with `llm.vendor=claude` must execute tasks identically to today
2. Run records must be readable by the current dashboard without migration
3. Token totals for Claude runs must be numerically identical
4. The `--allowed-tools` list passed to the Claude CLI must be identical
5. The system prompt content must be identical
6. Completion validation must produce the same pass/fail verdicts
7. Error messages must surface the same failure categories

---

## 6. Recommended Phase 2 Execution Strategy

### 6.1 Incremental extraction with regression gates

Each epic should follow this pattern:

1. **Capture baseline** — record the exact output (args, prompts, events, tokens, run records) of 3+ Claude runs
2. **Extract** — move code into new module
3. **Assert identical** — compare output against baseline
4. **Ship** — only proceed to next epic after regression suite is green

### 6.2 Feature flags for high-risk changes

| Change | Flag | Default |
|--------|------|---------|
| API provider registry resolution | `config.useRegistryProvider` | `false` |
| Event pipeline (RuntimeEvent accumulation) | `config.useEventPipeline` | `false` |

Both flags should default to `false` and be explicitly enabled per-project during validation.

### 6.3 Recommended epic ordering

```
1. Epic 6 — Contract tests first (establishes the regression baseline)
2. Epic 1 — Adapter extraction (highest risk; do early while codebase is stable)
3. Epic 3 — Prompt envelope (low risk, high value; validates section tagging)
4. Epic 2 — Event pipeline (builds on adapters; flag-gated)
5. Epic 5 — Diagnostics (additive; low risk)
6. Epic 4 — API generalization (last; highest Claude-path impact; flag-gated)
```

Note: this ordering differs from the Phase 2 plan document. The change is deliberate — **write contract tests first** so every subsequent epic has an automated regression gate.

---

## 7. Summary

### Phase 1 verdict

Phase 1 is **architecturally sound and safe for the Claude execution path**. The key evidence:

- The Claude API loop (`loop.ts`) is byte-for-byte identical to `main`
- The Claude CLI spawn functions (`buildClaudeCliArgs`, `spawnClaude`, `processStreamLine`) are unmodified
- The shared lifecycle (`shared.ts`) is unmodified
- All new code is either in new files or behind `vendor === "codex"` gates
- 5,400+ lines of new tests validate the integration

### Phase 2 risk verdict

Phase 2 carries **moderate risk** concentrated in two epics:

- **Epic 1 (Adapter Extraction)** — refactors the Claude CLI execution path. Mitigated by snapshot-based regression testing and incremental extraction.
- **Epic 4 (API Generalization)** — modifies the Claude API execution path. Mitigated by feature flags and integration testing.

The remaining four epics are low-risk (additive schema changes, test-only additions, prompt wrapping).

### Key recommendation

**Write contract tests (Epic 6) before any refactoring.** The tests establish the baseline that every subsequent epic is validated against. Without them, adapter extraction and event pipeline changes have no automated regression gate for the Claude path.
