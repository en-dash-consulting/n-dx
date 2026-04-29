---
id: "dd84153c-7c4d-488a-8ca6-81eab6623c2c"
level: "task"
title: "Circular Dependency Analysis and Planning"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T07:02:22.107Z"
completedAt: "2026-02-24T07:02:22.107Z"
acceptanceCriteria: []
description: "Analyze sourcevision findings to understand circular dependency structure and plan resolution approach"
---

## Subtask: Review sourcevision circular dependency findings for llm-client package

**ID:** `275d6bf0-c250-4a56-8e43-7106eb6bd258`
**Status:** completed
**Priority:** high

## Findings

Sourcevision analysis (2026-02-24T05:11:49, git sha 536ec50) detected **4 circular dependency chains** in `packages/llm-client/src/`.

### Root Cycle

All 4 chains are sub-paths of a single root cycle:

```
provider-interface.ts → llm-types.ts → create-client.ts → api-provider.ts → provider-interface.ts
provider-interface.ts → llm-types.ts → create-client.ts → cli-provider.ts → provider-interface.ts
```

### Dependency Graph (pre-fix)

```
provider-interface.ts ──imports LLMVendor──→ llm-types.ts
       ↑                                          │
       │                              imports CreateClientOptions
       │                                          ↓
 api/cli-provider.ts ←──provides factory── create-client.ts
       │
       └──imports LLMProvider──→ provider-interface.ts
```

### The 4 Chains Reported

1. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`
2. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts` (type import duplicate)
3. `provider-interface.ts → llm-types.ts → create-client.ts`
4. `cli-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`

### Affected Modules

- `provider-interface.ts` — LLMProvider interface + (was) LLMVendor consumer
- `llm-types.ts` — vendor-neutral types + (was) LLMVendor definition
- `create-client.ts` — Claude dual-provider factory
- `api-provider.ts` — Anthropic SDK provider
- `cli-provider.ts` — Claude CLI provider

### Root Cause

`provider-interface.ts` imported `LLMVendor` from `llm-types.ts`. `llm-types.ts` imported `CreateClientOptions` from `create-client.ts`. Both providers imported `LLMProvider` from `provider-interface.ts` to implement it. This formed a structural cycle even though all cross-layer imports were `import type`.

### Resolution (already applied in prior session)

`LLMVendor` was moved from `llm-types.ts` to `provider-interface.ts` as a self-contained definition. `llm-types.ts` re-exports it for backward compatibility. The `provider-interface.ts → llm-types.ts` import edge was eliminated, breaking all 4 chains. Zero circular dependencies remain.

**Acceptance Criteria**

- All circular dependency cycles in llm-client are documented with affected modules
- Dependency graph visualization shows current circular relationships
- Root causes of each circular dependency are identified

---

## Subtask: Design dependency refactoring strategy for llm-client

**ID:** `e39dac48-52eb-40eb-84d8-18606f441137`
**Status:** completed
**Priority:** high

## Dependency Refactoring Strategy: llm-client Circular Dependency Resolution

### Problem Statement
Sourcevision identified 4 circular dependency chains in packages/llm-client, all rooted in one cycle:
  provider-interface.ts → llm-types.ts → create-client.ts → (api|cli)-provider.ts → provider-interface.ts

### Root Cause Analysis
The cycle formed through these steps:
1. provider-interface.ts imported LLMVendor from llm-types.ts
2. llm-types.ts imported CreateClientOptions (type) from create-client.ts
3. create-client.ts imported createApiClient/createCliClient from provider modules
4. Provider modules imported LLMProvider/ProviderInfo from provider-interface.ts

### Dependency Layer Hierarchy
The llm-client module has 7 distinct layers:
- Layer 0 (foundation): types.ts, exec.ts, output.ts, json.ts, help-format.ts, suggest.ts
- Layer 1 (interfaces): provider-interface.ts — generic LLMProvider contract
- Layer 2 (config): config.ts, llm-config.ts
- Layer 3 (providers): api-provider.ts, cli-provider.ts, codex-cli-provider.ts
- Layer 4 (factories): create-client.ts, llm-client.ts
- Layer 5 (management): provider-registry.ts, provider-session.ts
- Layer 6 (aggregation): llm-types.ts, public.ts

### Strategy: Type Relocation via Dependency Inversion
**Chosen approach**: Move LLMVendor from Layer 6 (llm-types.ts) to Layer 1 (provider-interface.ts), then re-export from llm-types.ts for backward compatibility.

**Rationale**:
- LLMVendor identifies which vendor a provider implements — it belongs with the provider interface contract
- provider-interface.ts is the lowest layer that uses the type (ProviderInfo.vendor: LLMVendor)
- Re-exporting from llm-types.ts ensures zero breaking changes for existing consumers

**Alternatives considered and rejected**:
1. Extract to vendors.ts (new file): Adds a new file for a two-value type union; hard to discover
2. Move CreateClientOptions to llm-types.ts: Makes llm-types.ts import from factories (wrong direction)
3. Use import type everywhere: Already applied but does not break structural/tool-detected cycles
4. Split provider-interface.ts: Over-engineering; the file is small and cohesive

### Modules Changed
- provider-interface.ts: +8 lines — define and export LLMVendor with explanatory comment
- llm-types.ts: +2 lines — import LLMVendor from provider-interface.ts and re-export it

### Backward Compatibility
- All consumers of LLMVendor from @n-dx/llm-client continue to work unchanged
- public.ts exports unchanged
- No changes required in dependent packages (hench, rex, sourcevision, web, claude-client)

### Verification
- 323/323 tests pass in @n-dx/llm-client after the fix
- Runtime import graph: no circular dependencies remain
- Type-only imports (import type) form no runtime cycles and are safe
- Sourcevision circular dependency chain count: 4 → 0

**Acceptance Criteria**

- Refactoring plan specifies which modules to split or merge
- Strategy identifies shared abstractions to extract
- Plan maintains backward compatibility for public API
- Approach minimizes impact on dependent packages

---
