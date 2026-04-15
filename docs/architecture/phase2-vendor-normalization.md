# Phase 2: Vendor-Normalized Hench Execution

**Date:** 2026-04-01
**Status:** Discovery & Implementation Plan
**Depends on:** Phase 1 (Codex Workflow Parity) — expected merge from `feature/codex-integration-enhancements`
**Goal:** Make the hench agent execution process produce consistent, observable behavior regardless of which LLM vendor (Claude, Codex, or future providers) is selected.

---

## 1. Current State After Phase 1

Phase 1 established the dual-vendor init flow and a runtime contract foundation. The following are now in place:

### Delivered

| Area | What exists | Location |
|------|-------------|----------|
| Canonical assets | Shared skill source, vendor-specific rendering | `assistant-assets/manifest.json`, `assistant-assets/index.js` |
| Instruction parity | CLAUDE.md and AGENTS.md generated from same project guidance | `packages/core/claude-integration.js`, `packages/core/codex-integration.js` |
| Execution policy type | `ExecutionPolicy` with sandbox, approvals, tools | `packages/llm-client/src/runtime-contract.ts` |
| Prompt envelope | `PromptEnvelope`, `assemblePrompt()` | `packages/llm-client/src/runtime-contract.ts` |
| Failure taxonomy | `FailureCategory` (11 categories), `classifyVendorError()` | `packages/llm-client/src/runtime-contract.ts` |
| Runtime event schema | `RuntimeEvent`, `RuntimeDiagnostics` | `packages/llm-client/src/runtime-contract.ts` |
| Codex structured parsing | `processCodexJsonLine()` for `--json` JSONL output | `packages/hench/src/agent/lifecycle/cli-loop.ts` |
| Token diagnostics | `TokenDiagnosticStatus`: complete / partial / unavailable | `packages/llm-client/src/runtime-contract.ts` |
| Provider abstraction | `LLMProvider` interface, `ProviderRegistry`, `ProviderSession` | `packages/llm-client/src/provider-interface.ts` |
| Dual-vendor init | `setupAssistantIntegrations()` with vendor registry | `packages/core/assistant-integration.js` |
| Policy compilation | `compileCodexPolicyFlags()` | `packages/hench/src/agent/lifecycle/cli-loop.ts` |

### Not yet consumed

Several Phase 1 types exist but are not yet wired into the hench execution path:

- `RuntimeEvent` — defined but cli-loop.ts still produces ad hoc result objects
- `PromptEnvelope` / `assemblePrompt()` — defined but prompt construction in `planning/prompt.ts` does not use it
- `RuntimeDiagnostics` — defined but not collected during runs
- `ProviderRegistry` / `ProviderSession` — defined but hench dispatches through if/else in `dispatchVendorSpawn()`
- `classifyVendorError()` — defined but error handling still uses ad hoc string matching in places

---

## 2. Gap Analysis

### 2.1 Hench CLI loop is a vendor-interleaved monolith

`packages/hench/src/agent/lifecycle/cli-loop.ts` is 1200+ lines containing:

- Claude CLI arg building (`buildClaudeCliArgs`)
- Claude subprocess spawning (`spawnClaude`)
- Claude stream-json event parsing (`processStreamLine`)
- Codex subprocess spawning (`spawnCodex`)
- Codex JSONL event parsing (`processCodexJsonLine`)
- Codex heuristic fallback parsing (`normalizeCodexResponse`)
- Codex policy compilation (`compileCodexPolicyFlags`)
- Vendor dispatch (`dispatchVendorSpawn` — if/else on vendor string)
- Shared retry, accumulation, and success/error processing

Adding a third vendor would require modifying this file extensively and increasing the branching complexity.

### 2.2 API provider is Claude-only

`packages/hench/src/agent/lifecycle/loop.ts` (the API execution path) hard-gates on Claude:

```typescript
if (resolveLLMVendor(llmConfig) !== "claude") {
  throw new Error("API provider requires llm.vendor=claude");
}
```

There is no OpenAI API adapter for Codex, and no extension point for future API-based vendors.

### 2.3 Event stream normalization incomplete

Both vendors parse their CLI output but produce different intermediate shapes:

- Claude: `processStreamLine()` → `CliRunResult` (text, tool calls, token usage as flat fields)
- Codex: `processCodexJsonLine()` → `CliRunResult` (same shape, but different population patterns)

Neither path produces `RuntimeEvent` objects. The `RuntimeEvent` type from `runtime-contract.ts` is unused in execution.

### 2.4 Tool definitions are Claude-native

`TOOL_DEFINITIONS` in `packages/hench/src/tools/dispatch.ts` uses the Anthropic SDK tool schema format. For CLI mode this is translated to `--allowed-tools` patterns. Codex receives tools implicitly via MCP servers in `.codex/config.toml`, but there is no explicit tool definition compilation for Codex.

### 2.5 Prompt construction bypasses the envelope

`packages/hench/src/agent/planning/prompt.ts` builds system prompts as concatenated strings. The `PromptEnvelope` and `assemblePrompt()` from runtime-contract.ts are not used. Prompt sections are not tagged or traceable.

### 2.6 Run records lack vendor diagnostics

`packages/hench/src/schema/v1.ts` defines `TurnTokenUsage` with vendor/model fields, but there is no `RuntimeDiagnostics` field on the run record. After a run completes, there is no structured record of what sandbox mode, approval policy, parse mode, or token diagnostic status was active.

### 2.7 No cross-vendor contract tests

There are no tests that verify:
- Both vendors produce the same `RuntimeEvent` schema for equivalent scenarios
- Both vendors map errors to the same `FailureCategory`
- Both vendors receive equivalent prompt sections
- Run records from both vendors contain comparable diagnostic data

---

## 3. Target Architecture

### 3.1 Vendor adapter pattern

Replace the if/else dispatch in cli-loop.ts with a formal adapter interface:

```
VendorAdapter {
  buildArgs(envelope, policy, model) → SpawnConfig
  parseEvent(line) → RuntimeEvent | null
  mapTokenUsage(raw) → TokenUsage + TokenDiagnosticStatus
  classifyError(err) → FailureCategory
}
```

Concrete implementations:
- `ClaudeCliAdapter` — builds Claude CLI args, parses stream-json
- `CodexCliAdapter` — builds Codex CLI args, parses JSONL
- Future: `OpenAiApiAdapter`, `GeminiCliAdapter`, etc.

The shared loop orchestrates: spawn → parse events → accumulate → validate → finalize.

### 3.2 Unified event pipeline

```
CLI stdout → VendorAdapter.parseEvent() → RuntimeEvent → EventAccumulator → RunRecord
```

All run evaluation (spin detection, completion validation, budget checks) operates on `RuntimeEvent` streams, not vendor-specific result shapes.

### 3.3 Prompt envelope adoption

```
TaskBrief → PromptEnvelope (tagged sections) → VendorAdapter.buildArgs() → CLI spawn
```

Prompt construction produces a `PromptEnvelope`. Each vendor adapter translates it to native delivery format. Sections are logged for diagnostics.

### 3.4 API provider generalization

Generalize `agentLoop()` to accept any `LLMProvider` from the registry, not just Claude:

```
config.provider === "api" → ProviderRegistry.getActiveProvider(config) → LLMProvider.complete()
```

This enables future OpenAI API support without a separate code path.

### 3.5 Run diagnostics

Every run record includes a `RuntimeDiagnostics` snapshot captured at run start:

```json
{
  "vendor": "codex",
  "model": "gpt-5-codex",
  "sandbox": "workspace-write",
  "approvals": "never",
  "tokenDiagnosticStatus": "partial",
  "parseMode": "codex-jsonl",
  "notes": ["codex_usage_partial"]
}
```

---

## 4. Implementation Epics

### Epic 1: Vendor Adapter Extraction

**Goal:** Extract vendor-specific code from cli-loop.ts into self-contained adapter modules.

#### Feature 1.1: Define VendorAdapter interface

- **Task 1.1.1:** Define `VendorAdapter` interface in `packages/hench/src/agent/lifecycle/vendor-adapter.ts`
  - `buildSpawnConfig(envelope: PromptEnvelope, policy: ExecutionPolicy, model?: string): SpawnConfig`
  - `parseEvent(line: string, turn: number, metadata: TokenEventMetadata): RuntimeEvent | null`
  - `classifyError(err: unknown): FailureCategory`
  - `readonly vendor: LLMVendor`
  - `readonly parseMode: string`
- **Task 1.1.2:** Define `SpawnConfig` type (binary, args, env, stdinContent, cwd)
- **Task 1.1.3:** Export through hench's internal barrel

#### Feature 1.2: Extract ClaudeCliAdapter

- **Task 1.2.1:** Move `buildClaudeCliArgs()` into `packages/hench/src/agent/lifecycle/adapters/claude-cli-adapter.ts`
- **Task 1.2.2:** Move `processStreamLine()` and Claude-specific event parsing into the adapter
- **Task 1.2.3:** Move `spawnClaude()` subprocess config into `buildSpawnConfig()`
- **Task 1.2.4:** Implement `parseEvent()` that produces `RuntimeEvent` objects
- **Task 1.2.5:** Implement `classifyError()` delegating to `classifyVendorError()`
- **Task 1.2.6:** Add unit tests for Claude adapter in isolation

#### Feature 1.3: Extract CodexCliAdapter

- **Task 1.3.1:** Move `spawnCodex()`, `processCodexJsonLine()`, `normalizeCodexResponse()`, and `compileCodexPolicyFlags()` into `packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts`
- **Task 1.3.2:** Implement `buildSpawnConfig()` that compiles ExecutionPolicy to Codex flags
- **Task 1.3.3:** Implement `parseEvent()` producing `RuntimeEvent` from JSONL with heuristic fallback
- **Task 1.3.4:** Implement `classifyError()` delegating to `classifyVendorError()`
- **Task 1.3.5:** Add unit tests for Codex adapter in isolation

#### Feature 1.4: Refactor cli-loop.ts to use adapters

- **Task 1.4.1:** Replace `dispatchVendorSpawn()` with adapter-based dispatch
- **Task 1.4.2:** Create `resolveVendorAdapter(vendor: LLMVendor): VendorAdapter` factory
- **Task 1.4.3:** Refactor the main loop to call `adapter.buildSpawnConfig()` → spawn → `adapter.parseEvent()` per line
- **Task 1.4.4:** Remove vendor-specific functions from cli-loop.ts (now in adapter modules)
- **Task 1.4.5:** Verify existing E2E tests pass without behavioral changes

### Epic 2: Unified Event Pipeline

**Goal:** Make all run evaluation operate on `RuntimeEvent` streams instead of ad hoc result shapes.

#### Feature 2.1: Event accumulator

- **Task 2.1.1:** Create `packages/hench/src/agent/lifecycle/event-accumulator.ts`
- **Task 2.1.2:** Implement `EventAccumulator` class that collects `RuntimeEvent[]` and derives:
  - Total token usage (with diagnostic status)
  - Tool call count and list
  - Assistant message text
  - Completion summary
  - Failure details
- **Task 2.1.3:** Add method `toCliRunResult(): CliRunResult` for backward compatibility during migration
- **Task 2.1.4:** Add unit tests

#### Feature 2.2: Wire event pipeline into CLI loop

- **Task 2.2.1:** Replace inline result accumulation with `EventAccumulator`
- **Task 2.2.2:** Feed `adapter.parseEvent()` output directly into accumulator
- **Task 2.2.3:** Update spin detection to operate on `RuntimeEvent` stream
- **Task 2.2.4:** Update token budget checking to use accumulator totals
- **Task 2.2.5:** Verify run records contain equivalent data post-migration

#### Feature 2.3: Event persistence

- **Task 2.3.1:** Add optional `events: RuntimeEvent[]` field to `RunRecord` schema (v1 additive — no migration needed)
- **Task 2.3.2:** Store events when verbose/debug mode is enabled
- **Task 2.3.3:** Add `hench show --events <run-id>` subcommand for debugging

### Epic 3: Prompt Envelope Adoption

**Goal:** Use the existing `PromptEnvelope` type throughout prompt construction so both vendors receive tagged, traceable prompt sections.

#### Feature 3.1: Refactor prompt construction

- **Task 3.1.1:** Update `packages/hench/src/agent/planning/prompt.ts` to produce `PromptEnvelope` instead of flat strings
- **Task 3.1.2:** Tag each section with its canonical name (system, workflow, brief, files, validation, completion)
- **Task 3.1.3:** Update `packages/hench/src/agent/planning/brief.ts` to contribute sections to the envelope

#### Feature 3.2: Vendor-specific prompt delivery

- **Task 3.2.1:** `ClaudeCliAdapter.buildSpawnConfig()` uses `assemblePrompt()` to split system/task
- **Task 3.2.2:** `CodexCliAdapter.buildSpawnConfig()` uses `assemblePrompt()` and formats as `SYSTEM:\n...\nTASK:\n...`
- **Task 3.2.3:** Log prompt section names and sizes in run diagnostics

#### Feature 3.3: Prompt envelope tests

- **Task 3.3.1:** Assert both adapters receive identical section names for the same task
- **Task 3.3.2:** Assert section content is equivalent (not just present)
- **Task 3.3.3:** Assert no vendor receives sections the other doesn't

### Epic 4: API Provider Generalization

**Goal:** Remove the Claude-only gate from the API execution path and enable registry-based provider resolution.

#### Feature 4.1: Generalize agentLoop

- **Task 4.1.1:** Replace the Claude vendor check in `loop.ts` with `ProviderRegistry.getActiveProvider()`
- **Task 4.1.2:** Refactor `initApiResources()` to accept any `LLMProvider`
- **Task 4.1.3:** Translate tool definitions from Claude-native format to vendor-neutral format for the provider interface

#### Feature 4.2: OpenAI API adapter (stretch)

- **Task 4.2.1:** Add `OpenAiApiProvider` implementing `LLMProvider` in `packages/llm-client/src/openai-api-provider.ts`
- **Task 4.2.2:** Register in `ProviderRegistry` with vendor "codex" + mode "api"
- **Task 4.2.3:** Implement `complete()` using OpenAI SDK (or fetch-based)
- **Task 4.2.4:** Implement `stream()` for tool-use loop
- **Task 4.2.5:** Add auth detection for `OPENAI_API_KEY`

#### Feature 4.3: Tool definition normalization

- **Task 4.3.1:** Define a vendor-neutral tool schema type in `packages/llm-client/src/tool-schema.ts`
- **Task 4.3.2:** Add compilation functions: `toAnthropicToolDef()`, `toOpenAiToolDef()`
- **Task 4.3.3:** Refactor `TOOL_DEFINITIONS` in hench to use the neutral format
- **Task 4.3.4:** Both CLI adapters and API providers compile from the same source

### Epic 5: Run Diagnostics & Observability

**Goal:** Every run produces structured diagnostics that make the vendor contract floor observable.

#### Feature 5.1: Diagnostics collection

- **Task 5.1.1:** Add `diagnostics: RuntimeDiagnostics` field to `RunRecord` schema
- **Task 5.1.2:** Collect diagnostics at run start in `shared.ts` `initRunRecord()`
- **Task 5.1.3:** Update diagnostics at run end with final token status and parse mode
- **Task 5.1.4:** Include diagnostics in `hench show` output

#### Feature 5.2: Dashboard integration

- **Task 5.2.1:** Surface vendor diagnostics in the web dashboard run detail view
- **Task 5.2.2:** Add vendor/model filtering to run history views
- **Task 5.2.3:** Show token diagnostic status indicators (complete/partial/unavailable)

### Epic 6: Cross-Vendor Contract Test Suite

**Goal:** Codify the runtime identity contract as automated tests.

#### Feature 6.1: Adapter contract tests

- **Task 6.1.1:** Create `packages/hench/tests/unit/vendor-adapter-contract.test.ts`
- **Task 6.1.2:** Assert both adapters implement the full `VendorAdapter` interface
- **Task 6.1.3:** Feed identical mock events to both adapters, assert `RuntimeEvent` output shape matches
- **Task 6.1.4:** Feed identical error strings to both adapters, assert `FailureCategory` matches

#### Feature 6.2: Prompt parity tests

- **Task 6.2.1:** Assert both adapters receive the same `PromptEnvelope` sections for a given task
- **Task 6.2.2:** Assert instruction files (CLAUDE.md, AGENTS.md) derive from the same source and contain equivalent workflow content

#### Feature 6.3: Run record parity tests

- **Task 6.3.1:** Assert run records from both vendors contain `diagnostics` field
- **Task 6.3.2:** Assert token usage fields are populated or explicitly marked as unavailable (no silent zeros)
- **Task 6.3.3:** Assert both vendors produce the same `RunStatus` for equivalent outcomes

#### Feature 6.4: E2E smoke tests

- **Task 6.4.1:** Add E2E test: fresh project init → `hench run` with Claude CLI → verify run record shape
- **Task 6.4.2:** Add E2E test: fresh project init → `hench run` with Codex CLI → verify run record shape
- **Task 6.4.3:** Assert both E2E runs produce structurally identical run records (modulo vendor/model fields)

---

## 5. Dependency Graph & Ordering

```
Epic 6 (Contract Tests)               [FIRST — establishes regression baseline]
  └─→ Epic 1 (Adapter Extraction)     [refactor with tests already in place]
       ├─→ Epic 2 (Event Pipeline)    [needs adapters producing RuntimeEvent]
       └─→ Epic 3 (Prompt Envelope)   [needs adapters consuming PromptEnvelope]

Epic 2 (Event Pipeline)
  └─→ Epic 5 (Diagnostics)           [needs events for diagnostic collection]

Epic 4 (API Generalization)           [independent of Epics 1-3; flag-gated]
  └─→ Epic 4.2 (OpenAI API)          [stretch goal; depends on 4.1 + 4.3]

Epic 5 (Diagnostics)
  └─→ Epic 5.2 (Dashboard)           [needs diagnostics schema finalized]
```

**Recommended execution order:**

1. **Epic 6** — Contract tests first (establishes the regression baseline that every subsequent epic is validated against; without this, adapter extraction has no automated gate for the Claude path)
2. **Epic 1** — Adapter extraction (highest risk refactor; do early while codebase is stable, with contract tests as safety net)
3. **Epic 3** — Prompt envelope adoption (low risk, high value)
4. **Epic 2** — Event pipeline (builds on adapters + envelope; feature-flag gated)
5. **Epic 5** — Run diagnostics (builds on event pipeline)
6. **Epic 4** — API generalization (last; highest Claude-path impact; feature-flag gated)

> **Rationale for reordering:** The Phase 1 audit (`docs/architecture/phase1-audit-phase2-risk-assessment.md`) identified that the adapter extraction (Epic 1) physically moves Claude CLI functions into new modules — the highest-risk refactor in Phase 2. Writing contract tests first (Epic 6) ensures every extraction step has an automated regression gate. Epic 6's adapter-specific tests (Feature 6.1) can initially test the existing code paths directly; they don't require the adapter interface to exist yet.

### Parallelization opportunities

- Epic 4.3 (tool definition normalization) can start immediately — it's a foundation-layer change
- Epic 5.2 (dashboard integration) can start after Epic 5.1

---

## 6. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Adapter extraction introduces regressions in CLI execution | High | Contract tests (Epic 6) written first as regression gate; snapshot baselines capture exact Claude CLI args, prompts, and token totals before extraction begins |
| RuntimeEvent schema doesn't capture all vendor-specific nuances | Medium | Keep `vendorDetail` fields for raw data; adapter tests verify no data loss |
| OpenAI API provider blocked by SDK instability or missing features | Medium | Mark Epic 4.2 as stretch; CLI path is the primary Codex execution channel |
| Run record schema change breaks dashboard | Low | Additive change only (new `diagnostics` field); no existing field removal |
| Event persistence increases storage | Low | Gate behind verbose/debug mode; events are optional in schema |
| Tool definition normalization breaks existing Claude tool dispatch | Medium | Keep Anthropic format as the internal representation; add compile-to-neutral as a new function |

---

## 7. Breaking Changes

**None expected.** All changes are additive:

- New adapter modules alongside existing code (extract, don't rewrite)
- New schema fields are optional
- `CliRunResult` retained for backward compatibility during migration
- Existing E2E tests are the regression gate

The only behavioral change is that Codex runs will produce richer structured data (RuntimeEvent streams, diagnostics). This is an improvement, not a breaking change.

---

## 8. Verification Strategy

### Per-epic verification

| Epic | Verification |
|------|-------------|
| 1 (Adapters) | All existing hench E2E tests pass; `pnpm test` green across all packages |
| 2 (Events) | Run records from both vendors contain `events[]`; spin detection and budget checks still work |
| 3 (Envelope) | Both vendors log identical prompt section names; prompt parity tests pass |
| 4 (API) | `hench run --provider=api` works with both Claude and (stretch) OpenAI API keys |
| 5 (Diagnostics) | `hench show <run>` displays diagnostics; dashboard renders vendor info |
| 6 (Contract) | Full contract test suite passes; cross-vendor parity assertions are green |

### End-to-end validation

1. `ndx init . --assistants=claude,codex` — verify both surfaces provisioned
2. `ndx work .` with `llm.vendor=claude` — verify run completes with full diagnostics
3. Switch to `llm.vendor=codex` → `ndx work .` — verify run completes with comparable diagnostics
4. Compare run records — structurally identical modulo vendor/model fields
5. `ndx start .` → verify dashboard displays both runs with diagnostics

---

## 9. Future Vendor Extension (Post-Phase 2)

Once the adapter pattern is in place, adding a new vendor requires:

1. Add a new `FooCliAdapter` implementing `VendorAdapter`
2. Register in adapter factory (`resolveVendorAdapter`)
3. Add vendor config section to `LLMConfig` type
4. Add init integration in `packages/core/foo-integration.js`
5. Add vendor target in `assistant-assets/manifest.json`
6. Existing contract tests automatically cover the new adapter

No changes to the core loop, event pipeline, prompt envelope, or run evaluation logic.

---

## 10. Relationship to Phase 1 Artifacts

| Phase 1 Artifact | Phase 2 Usage |
|------------------|---------------|
| `runtime-contract.ts` types | Consumed by adapters, event pipeline, diagnostics |
| `classifyVendorError()` | Delegated to by adapter `classifyError()` |
| `assemblePrompt()` | Called by adapter `buildSpawnConfig()` |
| `ProviderRegistry` | Used by generalized `agentLoop()` |
| `ExecutionPolicy` | Compiled by each adapter's `buildSpawnConfig()` |
| `processCodexJsonLine()` | Moved into `CodexCliAdapter.parseEvent()` |
| `compileCodexPolicyFlags()` | Moved into `CodexCliAdapter.buildSpawnConfig()` |
| `assistant-assets/manifest.json` | Extended with tool definition schema for normalization |

---

## References

- `docs/analysis/claude-codex-runtime-identity-discovery.md` — Phase 1 discovery document
- `docs/process/codex-transport-artifact-decisions.md` — locked transport decisions
- `packages/llm-client/src/runtime-contract.ts` — shared contract types
- `packages/hench/src/agent/lifecycle/cli-loop.ts` — current execution loop
- `packages/llm-client/src/provider-interface.ts` — LLMProvider interface
- `CLAUDE.md` — project architecture and conventions
