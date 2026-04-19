# Config Schema → Settings UI Gap Audit

Enumerates every field in `.n-dx.json`, `.rex/config.json`, and `.hench/config.json` and
cross-references against settings views currently rendered in the dashboard.

Generated: 2026-04-18

---

## Legend

| Status | Meaning |
|--------|---------|
| **present** | Field has a working UI control in an existing view |
| **partial** | Field is exposed for reading or via a runtime control, but no config-editor UI |
| **missing** | No UI control exists |
| **n/a** | Internal field; not user-editable |

---

## .hench/config.json

Source: `packages/hench/src/schema/v1.ts` → `HenchConfig`, `GuardConfig`, `RetryConfig`  
UI owner: `packages/web/src/viewer/views/hench-config.ts` (served by `routes-hench.ts` `CONFIG_FIELD_META`)

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `schema` | n/a | — | — |
| `provider` | **present** | select (cli/api) | `ndx work` |
| `model` | **present** | text | `ndx work` |
| `maxTurns` | **present** | number | `ndx work` |
| `maxTokens` | **present** | number | `ndx work` |
| `tokenBudget` | **present** | number | `ndx work`, `ndx self-heal` |
| `rexDir` | **missing** | text | `ndx work` |
| `apiKeyEnv` | **present** | text | `ndx work` |
| `loopPauseMs` | **present** | number | `ndx work`, `ndx self-heal` |
| `maxFailedAttempts` | **present** | number | `ndx work`, `ndx self-heal` |
| `language` | **missing** | select (typescript/javascript/go) | `ndx work` (guard defaults), `ndx init` |
| `selfHeal` | n/a | — | runtime flag, set by `ndx self-heal` |
| `useEventPipeline` | n/a | — | migration flag |
| `useRegistryProvider` | n/a | — | migration flag |
| `claudePath` | n/a | — | auto-persisted by `ndx init` |
| `guard.blockedPaths` | **present** | list | `ndx work` |
| `guard.allowedCommands` | **present** | list | `ndx work` |
| `guard.commandTimeout` | **present** | number | `ndx work` |
| `guard.maxFileSize` | **present** | number | `ndx work` |
| `guard.spawnTimeout` | **missing** | number | `ndx work` (all tool spawns) |
| `guard.maxConcurrentProcesses` | **partial** | number (runtime control only — concurrency-panel.ts / throttle-controls.ts; no config editor) | `ndx work` |
| `guard.allowedGitSubcommands` | **missing** | list | `ndx work` (git tool) |
| `guard.policy.maxCommandsPerMinute` | **missing** | number | `ndx work` |
| `guard.policy.maxWritesPerMinute` | **missing** | number | `ndx work` |
| `guard.policy.maxTotalBytesWritten` | **missing** | number | `ndx work` |
| `guard.policy.maxTotalCommands` | **missing** | number | `ndx work` |
| `guard.memoryThrottle` | **missing** | complex (advanced) | `ndx work` |
| `guard.memoryMonitor` | **missing** | complex (advanced) | `ndx work` |
| `guard.pool` | **missing** | complex (advanced) | `ndx work` |
| `retry.maxRetries` | **present** | number | `ndx work` |
| `retry.baseDelayMs` | **present** | number | `ndx work` |
| `retry.maxDelayMs` | **present** | number | `ndx work` |

---

## .rex/config.json

Source: `packages/rex/src/schema/v1.ts` → `RexConfig`, `BudgetThresholds`, `LoEConfig`  
UI owner: none (no dedicated rex-config settings view exists)

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `schema` | n/a | — | — |
| `project` | **missing** | text | `ndx status`, `rex status` |
| `adapter` | **missing** | select (file/…) | `ndx sync` |
| `validate` | **missing** | text | `ndx work`, `ndx ci` |
| `test` | **missing** | text | `ndx work` |
| `sourcevision` | **missing** | select (auto/…) | `ndx plan`, `rex analyze` |
| `model` | **missing** | text | `ndx plan`, `ndx recommend` |
| `budget.tokens` | **missing** | number | `ndx plan`, `ndx recommend` |
| `budget.cost` | **missing** | number | `ndx plan`, `ndx recommend` |
| `budget.warnAt` | **missing** | number (0–100, percentage) | `ndx plan`, `ndx recommend` |
| `budget.abort` | **missing** | toggle | `ndx plan`, `ndx recommend` |
| `loe.taskThresholdWeeks` | **missing** | number | `ndx plan`, `ndx add` |
| `loe.maxDecompositionDepth` | **missing** | number | `ndx plan`, `ndx add` |
| `loe.proposalCeiling` | **missing** | number | `ndx plan`, `ndx add` |

---

## .n-dx.json (project-level)

Source: `packages/core/config.js` (`PROJECT_SECTIONS`, `HELP_TEXT`, `LLM_VALIDATORS`)

### Claude / LLM settings

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `claude.cli_path` | **missing** | text (path, machine-local) | `ndx work`, `ndx init` |
| `claude.api_key` | **missing** | password | `ndx work`, `ndx plan` |
| `claude.api_endpoint` | **missing** | url | `ndx work`, `ndx plan` |
| `claude.model` | **missing** | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `claude.lightModel` | **missing** | text | `ndx plan`, `ndx recommend` |
| `llm.vendor` | **missing** | select (claude/codex) | all LLM commands |
| `llm.claude.cli_path` | **missing** | text (path, machine-local) | `ndx work`, `ndx init` |
| `llm.claude.api_key` | **missing** | password | `ndx work`, `ndx plan` |
| `llm.claude.api_endpoint` | **missing** | url | `ndx work`, `ndx plan` |
| `llm.claude.model` | **missing** | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `llm.claude.lightModel` | **missing** | text | `ndx plan`, `ndx recommend` |
| `llm.codex.cli_path` | **missing** | text (path) | `ndx work`, `ndx init` |
| `llm.codex.api_key` | **missing** | password | `ndx work`, `ndx plan` |
| `llm.codex.api_endpoint` | **missing** | url | `ndx work`, `ndx plan` |
| `llm.codex.model` | **missing** | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `llm.codex.lightModel` | **missing** | text | `ndx plan`, `ndx recommend` |

### CLI settings

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `cli.claudePath` | **missing** | text (path) | `ndx work`, `ndx init` |
| `cli.timeoutMs` | **present** | number | all bounded commands (cli-timeout.ts) |
| `cli.timeouts.*` | **present** | number per command | per-command (cli-timeout.ts) |

### Web settings

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `web.port` | **missing** | number | `ndx start`, `ndx dev` |

### Feature flags

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `features.rex.*` | **present** | toggle (feature-toggles.ts) | varies |
| `features.sourcevision.*` | **present** | toggle (feature-toggles.ts) | varies |
| `features.hench.*` | **present** | toggle (feature-toggles.ts) | varies |

### Sourcevision zone overrides

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `sourcevision.zones.pins` | **missing** | complex (key-value map) | `ndx analyze`, `ndx plan` |
| `sourcevision.zones.mergeThreshold` | **missing** | number | `ndx analyze`, `ndx plan` |

### Language override

| Field | Status | Control type | CLI commands affected |
|-------|--------|-------------|----------------------|
| `language` | **missing** | select (typescript/javascript/go/auto) | `ndx init`, `ndx analyze`, `ndx work` |

---

## Summary counts

| Config file | Total user-editable | present | partial | missing |
|-------------|--------------------:|--------:|--------:|--------:|
| `.hench/config.json` | 25 | 14 | 1 | 10 |
| `.rex/config.json` | 13 | 0 | 0 | 13 |
| `.n-dx.json` | 25 | 5 | 0 | 20 |
| **Total** | **63** | **19** | **1** | **43** |

---

## Missing-field gap list (priority order)

Fields are ranked by expected user impact and how many commands they affect.

### P1 — LLM provider and model selection (affects every LLM command)

| Field | Control | Commands |
|-------|---------|---------|
| `llm.vendor` | select (claude/codex) | all LLM commands |
| `llm.claude.model` | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `llm.claude.lightModel` | text | `ndx plan`, `ndx recommend` |
| `llm.codex.model` | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `llm.codex.lightModel` | text | `ndx plan`, `ndx recommend` |
| `claude.model` | text | `ndx work`, `ndx plan`, `ndx recommend` |
| `claude.lightModel` | text | `ndx plan`, `ndx recommend` |

Note: `llm.*` fields are the preferred modern namespace; `claude.*` fields are the legacy
namespace. Both must be covered. Expose `llm.*` as primary with `claude.*` as fallback display.

### P2 — Rex project config (affects plan, work, ci, sync)

| Field | Control | Commands |
|-------|---------|---------|
| `rex.validate` | text | `ndx work`, `ndx ci` |
| `rex.test` | text | `ndx work` |
| `rex.model` | text | `ndx plan`, `ndx recommend` |
| `rex.budget.tokens` | number | `ndx plan`, `ndx recommend` |
| `rex.budget.cost` | number | `ndx plan`, `ndx recommend` |
| `rex.budget.warnAt` | number (%) | `ndx plan`, `ndx recommend` |
| `rex.budget.abort` | toggle | `ndx plan`, `ndx recommend` |
| `rex.project` | text | `ndx status` |
| `rex.adapter` | text | `ndx sync` |
| `rex.sourcevision` | text | `ndx plan` |
| `rex.loe.taskThresholdWeeks` | number | `ndx plan`, `ndx add` |
| `rex.loe.maxDecompositionDepth` | number | `ndx plan`, `ndx add` |
| `rex.loe.proposalCeiling` | number | `ndx plan`, `ndx add` |

### P3 — LLM auth / connectivity (sensitive fields)

| Field | Control | Commands |
|-------|---------|---------|
| `llm.claude.api_key` | password | `ndx work`, `ndx plan` |
| `llm.claude.api_endpoint` | url | `ndx work`, `ndx plan` |
| `llm.claude.cli_path` | text (path) | `ndx work`, `ndx init` |
| `llm.codex.api_key` | password | `ndx work`, `ndx plan` |
| `llm.codex.api_endpoint` | url | `ndx work`, `ndx plan` |
| `llm.codex.cli_path` | text (path) | `ndx work`, `ndx init` |
| `claude.api_key` | password | legacy; same as llm.claude.api_key |
| `claude.api_endpoint` | url | legacy; same as llm.claude.api_endpoint |
| `claude.cli_path` | text (path, machine-local) | legacy; same as llm.claude.cli_path |
| `cli.claudePath` | text (path) | `ndx work`, `ndx init` |

### P4 — Infrastructure settings

| Field | Control | Commands |
|-------|---------|---------|
| `web.port` | number | `ndx start`, `ndx dev` |
| `language` | select (typescript/javascript/go/auto) | `ndx init`, `ndx analyze`, `ndx work` |
| `hench.language` | select (typescript/javascript/go) | `ndx work` (guard defaults) |
| `hench.rexDir` | text | `ndx work` |

### P5 — Guard rail extensions (advanced, lower frequency)

| Field | Control | Commands |
|-------|---------|---------|
| `guard.spawnTimeout` | number | `ndx work` |
| `guard.maxConcurrentProcesses` | number (promote to config editor) | `ndx work` |
| `guard.allowedGitSubcommands` | list | `ndx work` |
| `guard.policy.maxCommandsPerMinute` | number | `ndx work` |
| `guard.policy.maxWritesPerMinute` | number | `ndx work` |
| `guard.policy.maxTotalBytesWritten` | number | `ndx work` |
| `guard.policy.maxTotalCommands` | number | `ndx work` |

### P6 — Advanced / not recommended for UI exposure

| Field | Reason |
|-------|--------|
| `guard.memoryThrottle` | Complex nested object; multi-field editor needed; low use frequency |
| `guard.memoryMonitor` | Complex nested object; low use frequency |
| `guard.pool` | Complex nested object; low use frequency |
| `sourcevision.zones.pins` | Key-value map; requires specialized editor; power user only |
| `sourcevision.zones.mergeThreshold` | Used by sourcevision team; low general demand |

---

## View placement recommendations

| Fields | Suggested view | Rationale |
|--------|---------------|-----------|
| `llm.vendor`, all `llm.*` / `claude.*` model+auth fields | New **LLM Provider** settings view | Grouped around the vendor switch; claude and codex tabs |
| `rex.validate`, `rex.test`, `rex.model`, `rex.budget.*`, `rex.loe.*`, `rex.project`, `rex.adapter`, `rex.sourcevision` | New **Rex Project** settings view | All rex config in one place |
| `web.port`, `language` | Existing or new **Project** settings view | Cross-cutting project-level settings |
| `guard.spawnTimeout`, `guard.maxConcurrentProcesses`, `guard.allowedGitSubcommands`, `guard.policy.*` | Extend existing **Hench Config** guard section | Additional guard rail rows |
| `hench.language`, `hench.rexDir` | Extend existing **Hench Config** general section | Two extra general rows |
