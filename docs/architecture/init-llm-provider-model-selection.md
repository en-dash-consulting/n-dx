# Init LLM Provider + Model Selection

**Date:** 2026-04-02
**Status:** Discovery & Implementation Plan
**Goal:** Make `ndx init` configure the active LLM in one guided flow: choose vendor first, then choose a vendor-specific model using a keyboard-driven terminal selector instead of numeric text entry.

---

## 1. Recommendation

Yes, selecting a Codex model during `ndx init` is the right move.

The current Codex path already supports an explicit model through `llm.codex.model`, and the runtime falls back to `gpt-5.5` only when that setting is absent. Making the model explicit at init time is a good fit for parity, reproducibility, and supportability:

- Codex execution already passes `-m <model>` when a model is resolved.
- Leaving model choice implicit makes behavior depend on runtime defaults and future vendor drift.
- The same flow should apply to Claude, not just Codex, so the UX stays vendor-neutral and the shared `llm.*` config becomes the single source of truth.

The key constraint is scope: the model should be stored in `.n-dx.json` under `llm.<vendor>.model`, not in `.codex/config.toml`. That file is currently and correctly MCP-only.

---

## 2. Current State

### 2.1 What `ndx init` does today

`packages/core/cli.js` currently handles provider selection inline:

- `promptInitProvider()` uses `readline/promises`
- the prompt is numeric text entry:
  - `1) codex`
  - `2) claude`
- init persists only `llm.vendor` by calling `runConfig(["llm.vendor", selectedProvider, dir])`
- there is no model selection stage

### 2.2 Where model defaults currently come from

The runtime already has vendor-specific model settings and defaults:

- `packages/llm-client/src/codex-cli-provider.ts`
  - default Codex model: `gpt-5.5`
- `packages/sourcevision/src/analyzers/claude-client.ts`
  - default Claude model: `claude-sonnet-4-6`
  - default Codex model for sourcevision/rex bridge use: `gpt-5.5`
- `packages/core/config.js`
  - already validates `llm.claude.model` and `llm.codex.model`

So the missing piece is not config support. The missing piece is guided config collection during init.

### 2.3 Existing architectural constraints

Any implementation has to preserve these current decisions:

- `packages/core/cli.js` is orchestration-tier and must not import `@n-dx/llm-client` or other package internals.
- `packages/core/config.js` is spawn-exempt, but tests require it to import only `node:` builtins.
- `.codex/config.toml` is intentionally MCP-only today.
  - `packages/core/codex-integration.js`
  - `tests/e2e/codex-artifact-validation.test.js`

These constraints matter because they rule out a naive solution like importing a model registry from `@n-dx/llm-client` into `packages/core/cli.js`.

---

## 3. Problems To Solve

### 3.1 UX problem

The current numeric prompt is functional but low quality:

- users must type `1` or `2`
- there is no follow-on model selection
- the flow does not feel symmetric with the richer multi-vendor direction of the project

### 3.2 Config completeness problem

Today, a fresh init sets only:

```json
{
  "llm": {
    "vendor": "codex"
  }
}
```

The default model remains implicit. That is acceptable for fallback behavior, but weak for:

- cross-machine reproducibility
- parity debugging
- future support requests
- vendor comparison

### 3.3 Parity problem

Codex raised the issue first, but the fix should be vendor-neutral. If init asks for a Codex model but not a Claude model, the workflow becomes asymmetric again.

---

## 4. Proposed Decision

### 4.1 Add an LLM configuration stage to `ndx init`

For interactive init:

1. Select active LLM vendor
2. Select model from that vendor's curated model list
3. Run vendor auth preflight
4. Persist config
5. Continue normal init

### 4.2 Persist to `.n-dx.json`, not assistant-specific files

Persist:

- `llm.vendor`
- `llm.claude.model` or `llm.codex.model`

Do not persist model choice to:

- `.codex/config.toml`
- `.claude/settings.local.json`
- `.hench/config.json`

Reason:

- the selected model is part of shared runtime config, not assistant artifact generation
- `sourcevision`, `rex`, and `hench` already read through the unified `llm.*` config
- Codex assistant config has an existing MCP-only contract that should remain intact

### 4.3 Replace numeric prompt with a keyboard-driven selector

Use an interactive terminal selector instead of freeform text entry.

Recommended behavior:

- arrow keys move between options
- `Tab` cycles when supported by the prompt library
- `Enter` confirms
- `Esc` or `Ctrl+C` cancels

A vertical select is the safest first implementation. A horizontal tab-look UI is fine if the library supports it cleanly, but a maintained select prompt matters more than forcing literal tab styling.

### 4.4 Keep non-interactive and scripted flows fully supported

Interactive prompting must remain optional.

Recommended flags:

- `--provider=<claude|codex>`
- `--model=<model-id>` for the active vendor
- optional convenience flags:
  - `--claude-model=<model-id>`
  - `--codex-model=<model-id>`

Flag precedence:

1. explicit CLI flags
2. existing project config
3. interactive prompt
4. runtime default fallback

---

## 5. UX Design

### 5.1 Fresh interactive init

Recommended flow:

```text
n-dx init

LLM setup
  Provider: [Codex] [Claude]
  Model:    [gpt-5.5] [other vendor-supported models]
```

After confirmation:

```text
LLM configuration
  Provider      codex
  Model         gpt-5.5
```

Then normal init summary continues.

### 5.2 Re-init behavior

Recommended behavior:

- if `llm.vendor` and `llm.<vendor>.model` already exist, skip the LLM prompt entirely
- if vendor exists but vendor model is missing, prompt only for the missing model in interactive mode
- if flags are provided, skip the prompt and trust the flags

This keeps re-init low-friction while allowing older projects to become explicitly configured over time.

### 5.3 Model list behavior

The initial implementation should use a curated local model catalog, not live vendor discovery.

Reasons:

- init should work offline
- model discovery through vendor CLIs is vendor-specific and not yet normalized
- testability is much better with a static catalog
- it avoids coupling init to auth state beyond the existing vendor preflight

The catalog can be refreshed in code when model support changes.

### 5.4 Recommended model choices

The first version should expose a short curated list, not every possible vendor model string.

Example shape:

- Claude
  - `claude-sonnet-4-6` recommended default
  - `claude-opus-4-20250514`
  - `claude-haiku-4-20250414`
- Codex
  - `gpt-5.5` recommended default
  - `gpt-5.4` rollout fallback
  - `gpt-5.4-mini` lighter coding/subagent option
  - `gpt-5.3-codex` coding-specialized option

The prompt should show friendly labels while persisting canonical model IDs.

---

## 6. Architecture Plan

### 6.1 Extract init LLM flow out of `packages/core/cli.js`

`packages/core/cli.js` currently owns too much inline init logic. The LLM selection flow should move into a peer orchestration module, for example:

- `packages/core/init-llm.js`

Suggested responsibilities:

- parse LLM-related init flags
- read existing LLM config from `.n-dx.json`
- resolve whether prompting is needed
- run interactive provider/model selection
- return a normalized selection object

Suggested shape:

```js
{
  provider: "codex",
  model: "gpt-5.5",
  providerSource: "selected",
  modelSource: "selected"
}
```

This keeps `handleInit()` focused on orchestration.

### 6.2 Add a local model catalog in `packages/core`

Because orchestration files cannot import `@n-dx/llm-client`, the init prompt needs its own catalog in the core package.

Suggested file:

- `packages/core/llm-model-catalog.js`

Suggested contents:

- vendor list
- model choices per vendor
- recommended/default entry per vendor
- display label and description per model

Example shape:

```js
export const LLM_MODEL_CATALOG = {
  codex: [
    { id: "gpt-5.5", label: "GPT-5.5", recommended: true },
    { id: "gpt-5.4", label: "GPT-5.4", recommended: false },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: false },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", recommended: false },
  ],
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", recommended: true },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  ],
};
```

This duplicates a small amount of model metadata by design. The mitigation is contract tests that assert the recommended core defaults stay aligned with runtime defaults.

### 6.3 Use a prompt library instead of raw `readline`

Recommended dependency:

- `enquirer`

Reasons:

- keyboard-driven selection is built in
- avoids hand-rolled raw-mode key handling
- works in plain Node CLI code
- can be isolated to `packages/core`

Implementation note:

- keep a small fallback path for non-TTY or test environments
- do not make the prompt library a requirement for `config.js`

### 6.4 Persist via `runConfig()`, not direct JSON writes

The init flow should continue to persist config by calling `runConfig()`:

- `runConfig(["llm.vendor", provider, dir])`
- `runConfig([vendorModelKey, model, dir])`

Why:

- validation already exists
- auth preflight already exists for `llm.vendor`
- `llm.claude.*` writes already keep legacy `claude.*` keys in sync
- it avoids a second config-writing path

Recommended write order:

1. collect selections in memory
2. write `llm.vendor`
3. write `llm.<vendor>.model`
4. continue init

If provider preflight fails, write nothing for the model.

---

## 7. Detailed Implementation Slices

### Epic 1: LLM init flow extraction

- create `packages/core/init-llm.js`
- move `promptInitProvider()` out of `packages/core/cli.js`
- add `resolveInitLLMSelection()` helper
- keep `handleInit()` as the entry point

### Epic 2: Interactive select UI

- add `enquirer` as a direct dependency of `packages/core`
- replace numeric provider prompt with a select prompt
- add vendor-specific model prompt
- handle cancel/escape cleanly

### Epic 3: Model catalog + config persistence

- add `packages/core/llm-model-catalog.js`
- map vendor to curated choices
- persist selected model using `runConfig()`
- update init summary to print both provider and model

### Epic 4: Flag support

- add `--model=<id>`
- optionally add `--claude-model=<id>` and `--codex-model=<id>`
- validate incompatible combinations
  - example: `--provider=codex --claude-model=...` should fail clearly
- allow fully non-interactive LLM configuration in CI and scripts

### Epic 5: Docs + help text

- update `packages/core/help.js`
- update `README.md`
- update `docs/guide/configuration.md`
- document that `.codex/config.toml` remains MCP-only

### Epic 6: Test coverage

- update `tests/e2e/cli-init.test.js`
- update `tests/e2e/cli-config.test.js`
- keep `tests/e2e/codex-artifact-validation.test.js` green without modification to `.codex/config.toml`
- add focused unit tests around the selection resolver and model catalog

---

## 8. Testing Plan

### 8.1 E2E init tests

Add coverage for:

- interactive vendor selection via select prompt
- interactive model selection after provider selection
- `--provider` + `--model` no-prompt path
- re-init with existing vendor/model skips prompt
- re-init with existing vendor but missing model prompts only for model
- summary includes both provider and model

### 8.2 Config tests

Add explicit config coverage for:

- `llm.codex.model`
- `llm.claude.model`
- invalid flag combinations
- legacy Claude sync when `llm.claude.model` is set

### 8.3 Contract tests

Add a small contract test that asserts:

- core recommended Claude model equals the expected shared Claude default
- core recommended Codex model equals `gpt-5.5`

This guards against catalog drift between init UX and runtime defaults.

---

## 9. Risks

### 9.1 Prompt-library test fragility

Interactive terminal prompts can be awkward to test in non-TTY environments.

Mitigation:

- keep decision logic separate from prompt rendering
- heavily test flag-driven and config-driven flows
- keep at most one thin interactive smoke path

### 9.2 Model catalog drift

A core-local catalog can drift from runtime defaults.

Mitigation:

- keep the catalog intentionally small
- add explicit default-alignment tests
- treat catalog updates as part of vendor upgrade work

### 9.3 Re-init surprise

Prompting for a model on older projects may surprise users who are used to silent re-init.

Mitigation:

- only prompt when the selected vendor has no explicit model configured
- skip prompts when flags or existing config fully resolve the selection

---

## 10. Non-Goals

- live vendor model discovery during init
- storing model configuration in `.codex/config.toml`
- changing assistant surface generation logic
- changing `hench` runtime model override semantics

---

## 11. Recommended Rex Breakdown

If you want to convert this into PRD work, the clean split is:

1. Extract init LLM selection logic into a dedicated core module.
2. Add keyboard-driven provider and model prompts.
3. Add model catalog and config persistence.
4. Add flag-based non-interactive model configuration.
5. Update help/docs.
6. Expand E2E and config coverage.

That ordering keeps the UX work separate from the config semantics and gives Hench a straightforward implementation path.
