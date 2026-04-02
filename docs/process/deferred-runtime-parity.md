# Deferred Runtime Parity: Post-Epic Boundary

**Date:** 2026-04-02
**Epic:** Codex Workflow Parity (eeb9eaa6)
**Task:** Document deferred runtime parity follow-up work (15ae7442)

This document records the Claude/Codex runtime differences that remain after the
Codex Workflow Parity epic lands. It draws a clear boundary between what the epic
delivered and what is intentionally deferred. Future work should target the
residual gaps listed here rather than reopening questions that the epic already
resolved.

---

## 1. What the Epic Delivered

The Codex Workflow Parity epic established **assistant-surface parity plus baseline
runtime guardrails**. Both Claude and Codex now share:

| Area | Deliverable | Location |
|------|-------------|----------|
| Instruction parity | AGENTS.md and CLAUDE.md generated from the same `project-guidance.md` | `assistant-assets/project-guidance.md` |
| Skill parity | Both vendors receive all 8 workflow skills from one canonical source | `assistant-assets/manifest.json`, `assistant-assets/index.js` |
| MCP parity | Both vendors get Rex and SourceVision MCP servers during init | `.codex/config.toml`, `claude mcp add` |
| Init orchestration | `setupAssistantIntegrations()` provisions both vendors by default | `packages/core/assistant-integration.js` |
| Runtime contract types | `PromptEnvelope`, `ExecutionPolicy`, `RuntimeEvent`, `FailureCategory`, `RuntimeDiagnostics`, `TokenDiagnosticStatus` | `packages/llm-client/src/runtime-contract.ts` |
| Codex structured output | `processCodexJsonLine()` for `--json` JSONL; heuristic fallback demoted | `packages/hench/src/agent/lifecycle/cli-loop.ts` |
| Codex policy compilation | `compileCodexPolicyFlags()` replaces `--full-auto` preset alias | `packages/llm-client/src/codex-cli-provider.ts` |
| Token diagnostics | `TokenDiagnosticStatus` (complete/partial/unavailable) replaces silent zero-value fallback | `packages/llm-client/src/runtime-contract.ts` |
| Failure taxonomy | 11 shared `FailureCategory` values with `classifyVendorError()` | `packages/llm-client/src/runtime-contract.ts` |
| Documentation | Startup banners, help text, README, and guides mention both vendors | Multiple docs and source files |
| Regression tests | 160+ tests covering skill sync, artifact validation, MCP contracts, runtime parity, and assistant-parity smoke | Multiple test files |

**What this means:** A user can run `ndx init .` and get a repo provisioned for
both Claude and Codex. Both assistants see equivalent workflow instructions, the
same MCP tools, and the same skill library. The runtime contract types exist and
are tested, providing the foundation for consistent execution.

---

## 2. What the Epic Did NOT Deliver

The following areas are **resolved in principle** (types exist, decisions are
locked) but **not yet consumed in the execution path**. These are the residual
gaps.

### 2.1 Runtime contract types are defined but not wired

Several Phase 1 types exist in `runtime-contract.ts` but are not yet consumed by
the hench execution loop:

| Type | Status | Gap |
|------|--------|-----|
| `RuntimeEvent` | Defined + tested | cli-loop.ts still produces ad hoc `CliRunResult` objects, not `RuntimeEvent` streams |
| `PromptEnvelope` / `assemblePrompt()` | Defined + tested | `planning/prompt.ts` builds prompts as concatenated strings, not envelopes |
| `RuntimeDiagnostics` | Defined + tested | Not collected or persisted during runs |
| `ExecutionPolicy` | Defined + tested | Codex flags compiled from it, but the policy object is not constructed from user config yet |

**Impact:** The contract types are the right abstraction. They just need to be
adopted in the execution path. No re-design required.

### 2.2 API-mode is Claude-only

`packages/hench/src/agent/lifecycle/loop.ts` hard-gates on Claude:

```typescript
if (resolveLLMVendor(llmConfig) !== "claude") {
  throw new Error("API provider requires llm.vendor=claude");
}
```

There is no OpenAI API adapter, no extension point for future API-based vendors,
and no `ProviderRegistry` dispatch in the API path.

**Impact:** Users who need API-mode execution must use Claude. Codex is CLI-only.
This is acceptable for the baseline workflow contract — CLI execution covers the
primary use case — but full vendor parity requires API-mode generalization.

### 2.3 CLI loop is a vendor-interleaved monolith

`cli-loop.ts` (1200+ lines) contains vendor-specific arg building, subprocess
spawning, event parsing, policy compilation, and shared orchestration logic
interleaved in one file. Adding a third vendor would require modifying the file
extensively.

**Impact:** No functional gap for two vendors, but structural debt that grows
with each vendor addition.

### 2.4 Tool definitions are Claude-native

`TOOL_DEFINITIONS` in `packages/hench/src/tools/dispatch.ts` uses the Anthropic
SDK tool schema format. For CLI mode this translates to `--allowed-tools`
patterns. Codex receives tools implicitly via MCP, with no explicit tool
definition compilation.

**Impact:** Both vendors get the tools they need today. The gap is that tool
definitions aren't compiled from a single vendor-neutral schema.

### 2.5 Run records lack vendor diagnostics

`RunRecord` in `packages/hench/src/schema/v1.ts` has no `RuntimeDiagnostics`
field. After a run completes, there is no structured record of what sandbox mode,
approval policy, parse mode, or token diagnostic status was active.

**Impact:** Debugging vendor-specific execution differences requires reading logs
rather than inspecting run records.

### 2.6 Multi-turn observability differs

Claude's `--output-format stream-json` provides per-turn events with tool calls,
results, and token usage. Codex's `--json` JSONL output provides structured
events but with different granularity. The hench execution path does not normalize
these into a shared event accumulator.

**Impact:** Run evaluation (spin detection, budget checks) operates on different
intermediate shapes per vendor. Both work, but the code paths diverge where they
could be unified.

### 2.7 No cross-vendor contract tests at the execution level

The epic added 92 cross-vendor runtime parity tests covering contract types,
prompt sections, policy compilation, event schema, failure classification, and
token diagnostics. However, there are no tests that:

- Feed identical mock CLI output from both vendors through the execution loop
  and assert identical `RuntimeEvent` streams
- Verify that run records from both vendors contain comparable diagnostic data
- Run fresh-project init-to-execution smoke paths for both vendors end-to-end

**Impact:** Contract types are tested in isolation. The gap is integration-level
verification that both vendors produce equivalent observable behavior through the
full execution path.

---

## 3. Deferred Artifact and Config Decisions

The following items were explicitly deferred in the transport and artifact
decisions document (`docs/process/codex-transport-artifact-decisions.md`):

| Deferred item | Category | Notes |
|---------------|----------|-------|
| HTTP transport auto-registration for Codex | Transport | stdio is sufficient; HTTP requires `ndx start` |
| Transport auto-detection / negotiation | Transport | No use case yet |
| Dynamic transport switching at runtime | Transport | Over-engineering for two transports |
| `CLAUDE.md` `@AGENTS.md` import syntax | Instructions | Depends on Claude Code supporting the import; both files are already generated from the same source |
| `CODEX.md` retirement timeline | Instructions | Kept as compatibility artifact |
| Directory-scoped `AGENTS.md` for sub-packages | Instructions | Not needed until sub-package workflows exist |
| Skill argument validation / structured schemas | Skills | Current plain-text skills work; structured args are a future enhancement |
| Per-skill enablement toggles in `.n-dx.json` | Skills | All skills are always generated |
| `sandbox_mode` / `approval_policy` in `.codex/config.toml` | Config | Blocked until config object is wired into init; Codex flags are compiled at runtime instead |
| Model / provider settings in `.codex/config.toml` | Config | Users configure `llm.vendor` via `ndx config`, not per-assistant config files |
| `project_doc_fallback_filenames` in `.codex/config.toml` | Config | AGENTS.md is sufficient; fallback names add complexity |
| Merging with existing user `.codex/config.toml` | Config | Init currently overwrites; merge requires conflict resolution logic |
| Auto-detecting installed assistants during init | Init | Init writes files regardless of assistant CLI availability |
| Per-assistant configuration sections in `.n-dx.json` | Init | Not needed while init provisions both unconditionally |

---

## 4. Phase 2 Implementation Plan

The detailed implementation plan for consuming the runtime contract types and
closing the execution-level gaps is documented in:

**`docs/architecture/phase2-vendor-normalization.md`**

That document defines 6 implementation epics:

1. **Vendor Adapter Extraction** — Extract vendor-specific code from cli-loop.ts
   into self-contained `ClaudeCliAdapter` and `CodexCliAdapter` modules
2. **Unified Event Pipeline** — Make all run evaluation operate on `RuntimeEvent`
   streams via an `EventAccumulator`
3. **Prompt Envelope Adoption** — Use `PromptEnvelope` throughout prompt
   construction so both vendors receive tagged, traceable sections
4. **API Provider Generalization** — Remove the Claude-only gate from the API
   execution path; enable registry-based provider resolution
5. **Run Diagnostics & Observability** — Persist `RuntimeDiagnostics` on every
   run record; surface in dashboard
6. **Cross-Vendor Contract Test Suite** — Codify the runtime identity contract
   as automated integration and E2E tests

**Recommended execution order:** Epics 1 → 3 → 2 → 5 → 6 → 4 (see the Phase 2
document for dependency graph and parallelization opportunities).

---

## 5. Boundary Rules

These rules define what is resolved and what is open:

### Resolved — do not reopen

- **Instruction loading:** AGENTS.md and CLAUDE.md are generated from the same
  source. The parity question is settled.
- **MCP availability:** Both vendors get the same MCP servers during init. The
  tool access question is settled.
- **Skill parity:** Both vendors receive all workflow skills from the canonical
  asset layer. The skill content question is settled.
- **Runtime contract types:** `PromptEnvelope`, `ExecutionPolicy`,
  `RuntimeEvent`, `FailureCategory`, `RuntimeDiagnostics`, and
  `TokenDiagnosticStatus` are the right abstractions. Do not redesign them;
  consume them.
- **Failure taxonomy:** The 11 shared categories in `FailureCategory` plus
  `classifyVendorError()` are the single entry point for error classification.
  Do not add vendor-specific classification paths.
- **Token diagnostics:** `TokenDiagnosticStatus` (complete/partial/unavailable)
  is the right model. Silent zero-value fallbacks are not acceptable.
- **Init defaults:** Both vendors are provisioned by default. `--no-claude` and
  `--no-codex` flags exist for opt-out.

### Open — target these in future work

- **Wiring runtime contract types into the execution loop** (§2.1)
- **API-mode generalization beyond Claude** (§2.2)
- **Vendor adapter extraction from cli-loop.ts** (§2.3)
- **Vendor-neutral tool definition schema** (§2.4)
- **RuntimeDiagnostics on run records** (§2.5)
- **Unified event accumulation across vendors** (§2.6)
- **Integration-level cross-vendor contract tests** (§2.7)
- **Deferred artifact and config decisions** (§3)

---

## 6. Vendor Capability Mismatches (Non-Blocking)

These are inherent vendor differences that the shared workflow contract does not
attempt to eliminate. They are documented here to prevent future work from
treating them as bugs:

| Difference | Claude | Codex | Why it's acceptable |
|------------|--------|-------|---------------------|
| Output format | stream-json (per-event structured stream) | JSONL (line-delimited events) | Both are structured; normalization is a wrapper concern, not a contract gap |
| Turn model | Multi-turn with explicit tool-use loop | Effectively single-turn with internal tool dispatch | Both complete tasks; the internal turn model is a vendor implementation detail |
| Prompt delivery | Separate `--system-prompt` flag | Combined positional argument | `assemblePrompt()` handles the translation; same content reaches both |
| Token accounting granularity | Full per-turn breakdown | Partial or aggregate | `TokenDiagnosticStatus` explicitly signals the diagnostic level |
| Native instruction file | `CLAUDE.md` | `AGENTS.md` | Both generated from `project-guidance.md`; file name is a vendor convention |
| Permission model | Per-tool allowlists | Sandbox mode + approval policy | `ExecutionPolicy` normalizes intent; vendor flags differ by design |
| CLI binary | `claude` | `codex` | Wrapper concern; transparent to the user workflow |

---

## References

- `docs/analysis/claude-codex-runtime-identity-discovery.md` — original runtime
  identity analysis (defines the target contract)
- `docs/architecture/phase2-vendor-normalization.md` — Phase 2 implementation
  plan (6 epics for closing execution-level gaps)
- `docs/process/codex-transport-artifact-decisions.md` — locked first-pass
  artifact and transport decisions
- `packages/llm-client/src/runtime-contract.ts` — shared runtime contract types
- `packages/hench/src/agent/lifecycle/cli-loop.ts` — current execution loop
  (vendor-interleaved, target of Phase 2 refactoring)
