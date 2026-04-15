# Claude/Codex Runtime Identity Discovery

**Date:** 2026-03-31
**Objective:** Define what "runtime behavior identity" should mean for Claude and Codex inside n-dx, audit the current runtime differences, and recommend guardrails that create a consistent baseline execution contract even when model outputs remain vendor-specific.
**Scope:** `packages/hench/`, `packages/llm-client/`, `docs/guide/configuration.md`, `docs/packages/llm-client.md`, Claude Code docs, and Codex docs.

---

## 1. Executive Summary

Claude and Codex do not currently behave like interchangeable execution surfaces in n-dx.

That is not primarily because the models differ. The larger problem is that **n-dx wraps them differently**:

- Claude has a dual provider stack (API or CLI), structured streaming output, explicit tool allowlists, and fuller token accounting.
- Codex is currently treated as a CLI-only path, driven through `codex exec --full-auto`, with combined `SYSTEM/TASK` prompting, heuristic response normalization, and partial/zero token accounting.

The right target is **behavioral identity at the workflow contract level**, not text identity at the model-output level.

That means Claude and Codex should both satisfy the same baseline expectations:

- they load equivalent repo guidance
- they see the same MCP servers and workflow tools
- they run inside comparable approval/sandbox envelopes
- they emit enough structured events for n-dx to interpret runs consistently
- they produce the same run lifecycle states, completion checks, and failure reasons

The main recommendation is to add a new implementation track focused on **runtime identity guardrails**. This should harden the Codex path toward the same observable contract the Claude path already approximates, while explicitly preserving room for vendor-specific reasoning and coding choices.

---

## 2. What Runtime Identity Should Mean

### 2.1 Not the goal

Runtime identity should **not** mean:

- same words in the assistant response
- same tool-call order
- same token counts
- same exact code edits
- same number of turns

Those vary naturally by vendor, model family, release, and prompt sensitivity.

### 2.2 Actual goal

Runtime identity **should** mean:

1. The same task brief and workflow constraints are delivered to both runtimes.
2. Both runtimes can access the same sanctioned tools and MCP servers.
3. Both runtimes operate inside a comparable permission/sandbox policy.
4. Both runtimes emit enough structured information for n-dx to classify the run the same way.
5. Both runtimes are held to the same completion validation and review gates.
6. Both runtimes surface failures through the same user-facing categories.

This is the baseline expectation a user can reasonably trust regardless of whether they choose Claude or Codex.

---

## 3. Current n-dx Runtime Audit

### 3.1 Shared layer: vendor-neutral in principle

The foundation package already claims a vendor-neutral contract:

- `packages/llm-client/src/provider-registry.ts`
- `packages/llm-client/src/create-client.ts`
- `docs/packages/llm-client.md`

The intended shape is:

- Claude: API or CLI
- Codex: CLI
- one shared provider registry used by Rex and Hench

This is a solid architectural direction. The runtime divergence appears further up the stack.

### 3.2 Claude path today

Claude currently has two runtime modes in n-dx:

- API mode through `packages/llm-client/src/api-provider.ts`
- CLI mode through `packages/llm-client/src/cli-provider.ts`

In Hench CLI execution, Claude is launched through `packages/hench/src/agent/lifecycle/cli-loop.ts` with:

- `--output-format stream-json`
- a separate system prompt
- an explicit `--allowed-tools` list derived from guard configuration
- per-turn event parsing
- token usage capture from structured output

Operationally, this gives Claude a relatively rich execution envelope:

- explicit tool policy
- explicit stream shape
- explicit turn accounting

### 3.3 Codex path today

Codex currently behaves differently in two important layers.

In `@n-dx/llm-client`:

- `packages/llm-client/src/codex-cli-provider.ts` runs `codex exec --skip-git-repo-check -o <file>`
- it reads the final output from a file
- it returns plain text and no structured tool stream

In Hench:

- `packages/hench/src/agent/lifecycle/cli-loop.ts` runs `codex exec --full-auto --skip-git-repo-check -o <file>`
- prompt delivery is a combined string:
  - `SYSTEM:\n...`
  - `TASK:\n...`
- stdout is normalized heuristically through `normalizeCodexResponse()`
- token usage is backfilled through `mapCodexUsageToTokenUsage()` and often defaults to zero

This creates a materially different runtime contract from Claude.

### 3.4 Concrete current differences

| Area | Claude in n-dx | Codex in n-dx | Identity impact |
|---|---|---|---|
| Provider modes | API + CLI | CLI only | High |
| Prompt injection | separate system prompt | combined `SYSTEM/TASK` text | Medium |
| Tool permissions | explicit allowlist | implicit through `--full-auto` | High |
| Output parsing | structured stream-json | heuristic stdout normalization | High |
| Turn model | multi-turn stream events | effectively collapsed to one normalized turn | High |
| Token accounting | full or near-full | partial / missing / synthetic zero | Medium |
| CLI safety controls | explicit tool filtering | relies on Codex preset alias | High |
| Failure semantics | richer event/result channel | mostly stdout/stderr + normalization | High |

---

## 4. Official Vendor Capability Notes

### 4.1 Codex official behavior

Official Codex docs currently show:

- `AGENTS.md` is the native project instruction file for Codex, with directory-layered precedence and optional fallback names.
- Codex supports `project_doc_fallback_filenames` in `config.toml`.
- Codex supports local MCP definitions through `.codex/config.toml` `mcp_servers.*`.
- `codex exec --json` emits JSON Lines event output for automation.
- `codex exec --full-auto` is an alias for `--sandbox workspace-write --ask-for-approval on-request`.
- Codex exposes explicit `sandbox_mode` and `approval_policy` config knobs.

Implication:

Codex has official primitives for:

- structured automation output
- explicit sandbox configuration
- explicit approval policy
- repo-local instruction discovery
- repo-local MCP configuration

The current n-dx runtime uses only part of that surface.

### 4.2 Claude official behavior

Official Claude Code docs currently show:

- Claude reads `CLAUDE.md`, not `AGENTS.md`, but a `CLAUDE.md` file can import `@AGENTS.md`.
- Claude supports project-level rules and hierarchical instruction loading.
- Claude supports structured CLI output with `--output-format json` and `--output-format stream-json`.
- Claude exposes configurable permission rules (`allow`, `ask`, `deny`) and permission modes.
- Claude supports project-scoped MCP through `.mcp.json`.

Implication:

Claude's current n-dx wrapper aligns more closely with its official structured CLI surface than the Codex wrapper does with Codex's official structured automation surface.

---

## 5. Main Finding

The current behavior gap is mostly **wrapper asymmetry**, not unavoidable model asymmetry.

The strongest evidence:

1. Codex officially supports structured JSONL automation output, but n-dx currently normalizes plain stdout heuristically.
2. Codex officially supports explicit approval and sandbox policies, but n-dx currently relies on the `--full-auto` preset alias instead of setting a normalized vendor policy contract directly.
3. Claude already uses explicit tool gating via `--allowed-tools`, while Codex currently does not get an equivalent n-dx-generated policy surface.
4. Claude and Codex load different repository instruction formats by default (`CLAUDE.md` vs `AGENTS.md`), which means runtime divergence begins before either model sees the task.

This is good news: most of the inconsistency is fixable in n-dx.

---

## 6. Target Runtime Identity Contract

The recommended identity contract for n-dx is below.

### 6.1 Instruction identity

Both vendors should see equivalent project guidance:

- one shared canonical workflow instruction source
- Claude path:
  - `CLAUDE.md` or `.claude/CLAUDE.md`
  - may import `@AGENTS.md`
- Codex path:
  - `AGENTS.md`
  - optional fallback filenames only when explicitly configured

Guardrail:

- generate or derive both instruction surfaces from the same assistant asset source

### 6.2 Tool and MCP identity

Both vendors should have access to the same ndx tools:

- Rex MCP
- SourceVision MCP
- comparable file/shell capabilities

Guardrail:

- one canonical MCP manifest
- Claude output:
  - `.mcp.json` or local/user registration path as appropriate
- Codex output:
  - `.codex/config.toml`

### 6.3 Permission identity

Both vendors should run under the same intended execution policy:

- read-only
- workspace-write
- danger-full-access only when explicitly justified

And they should share the same approval intent:

- interactive local execution: ask when crossing the normal boundary
- unattended execution: never ask, fail deterministically instead

Guardrail:

- define one n-dx execution policy object
- compile it to vendor-specific flags/config

### 6.4 Event identity

Both runtimes should produce enough structure that Hench can classify:

- assistant messages
- tool calls
- tool results
- completion summary
- failure summary
- token usage diagnostics

Guardrail:

- use structured output modes on both vendors wherever possible
- normalize both to one internal event schema before run evaluation

### 6.5 Completion identity

A task should be considered complete only when the same postconditions are satisfied regardless of vendor:

- meaningful code or repo state change
- completion validation passes
- review gate passes when enabled
- PRD status updates happen through the same rules

Guardrail:

- keep validation and review fully vendor-neutral and downstream of the LLM

---

## 7. Recommended Guardrails

### 7.1 Introduce a normalized runtime policy object

n-dx should define one internal execution policy with fields like:

```ts
{
  sandbox: "read-only" | "workspace-write" | "danger-full-access",
  approvals: "on-request" | "untrusted" | "never",
  networkAccess: boolean,
  writableRoots: string[],
  allowedCommands: string[],
  allowedFileTools: string[]
}
```

Then compile that policy to:

- Claude CLI flags / settings
- Codex CLI flags / config

This removes "preset alias drift" from the runtime.

### 7.2 Use structured machine-readable output for Codex

Codex should move closer to the Claude path by using official automation-friendly output:

- `codex exec --json`
- keep `-o` / final-message output when useful

Current Codex heuristic parsing is better than nothing, but it should be treated as a compatibility fallback, not the main runtime protocol.

### 7.3 Normalize prompt delivery

n-dx currently gives vendors semantically different prompt channels:

- Claude: separate system prompt + prompt text
- Codex: one combined `SYSTEM/TASK` string

Recommendation:

- define one internal prompt envelope
- include the same named sections for both vendors
- inject it through the best supported vendor mechanism, but preserve section identity exactly

Example canonical sections:

- role/system
- workflow constraints
- task brief
- relevant files
- validation requirements
- completion contract

### 7.4 Align instruction loading strategy

If Codex uses `AGENTS.md` and Claude uses `CLAUDE.md`, the two assistants start with different repo instructions unless n-dx bridges them explicitly.

Recommendation:

- generate `AGENTS.md` as the canonical repo guidance surface for Codex
- generate a `CLAUDE.md` that imports `@AGENTS.md` plus any Claude-only additions
- keep both derived from the same underlying asset source

### 7.5 Standardize failure taxonomy

Both vendors should map into the same run-status reasons:

- auth
- not-found
- timeout
- rate-limit
- completion_rejected
- budget_exceeded
- spin_detected
- malformed_output
- mcp_unavailable

Codex currently leaks more raw CLI behavior into the classification path than Claude.

Recommendation:

- centralize vendor error normalization
- record vendor-specific raw details separately from the shared failure code

### 7.6 Separate "usage parity" from "usage completeness"

Users need comparable budget and diagnostics, but Codex may not expose the same usage data shape as Claude on every path.

Recommendation:

- preserve a shared token usage object
- add explicit vendor diagnostics when fields are absent
- test for:
  - accurate mapping when usage exists
  - explicit degraded-mode signaling when usage is missing

Zero tokens with no diagnostic should never be treated as acceptable parity.

### 7.7 Add a baseline identity test suite

The test target should not be "same exact answer."

It should be:

- same instruction files loaded
- same MCP availability
- same task brief sections present
- same permission envelope
- same internal event schema produced
- same completion gate behavior
- same error category on equivalent failures

---

## 8. Recommended Implementation Areas

### 8.1 Runtime contract layer

Add a shared runtime contract module that defines:

- prompt envelope
- execution policy
- normalized event schema
- normalized failure taxonomy

This should become the source of truth for both vendors.

### 8.2 Codex execution hardening

Update the Codex path in:

- `packages/hench/src/agent/lifecycle/cli-loop.ts`
- `packages/llm-client/src/codex-cli-provider.ts`

Recommended changes:

- prefer `--json` for automation
- keep final summary file output as a secondary channel
- stop relying on implicit `--full-auto` semantics alone
- make sandbox/approval intent explicit
- normalize event mapping against the same internal schema used by Claude parsing

### 8.3 Claude/Codex instruction bridge

Update the assistant-asset and init work so that:

- Codex gets `AGENTS.md`
- Claude gets `CLAUDE.md` that imports `@AGENTS.md`
- both are generated from the same source

This is necessary if runtime identity is meant to start at repo guidance rather than only at CLI invocation.

### 8.4 Shared baseline diagnostics

Add vendor-neutral run diagnostics that make the identity floor observable:

- loaded instruction sources
- loaded MCP servers
- chosen sandbox/approval mode
- vendor/model
- token diagnostic status
- parse mode used

This should be available in logs and tests.

### 8.5 Cross-vendor contract tests

Add tests that verify:

- structured Codex output parsing
- Claude and Codex event normalization
- shared failure classification
- generated assistant artifact parity
- fresh-project init + execution smoke path

---

## 9. Suggested PRD Follow-on Work

This discovery suggests a dedicated runtime-focused implementation slice in addition to the current Codex parity epic.

Recommended feature:

- **Runtime Identity Guardrails**

Recommended tasks:

1. Define a normalized Claude/Codex runtime contract
2. Normalize Codex CLI execution flags and structured output handling
3. Align Claude/Codex instruction loading around shared project guidance
4. Normalize token diagnostics and failure taxonomy across vendors
5. Add cross-vendor baseline runtime fixtures and smoke tests

Recommended additions to the broader parity epic:

- explicit end-to-end smoke test for a fresh repo initialized for Codex
- explicit documentation of accepted model variance versus wrapper variance

---

## 10. Conclusions

The goal should be:

- **same guardrails**
- **same workflow expectations**
- **same observability**
- **same completion bar**

Not:

- same prose
- same reasoning path
- same code patch

If n-dx implements the guardrails described here, a user should be able to choose Claude or Codex and still trust the same baseline workflow behavior:

- repo instructions load correctly
- sanctioned tools are available
- permissions behave predictably
- runs are interpreted consistently
- completion means the same thing

That is the right definition of runtime identity for this project.

---

## References

Repo references:

- `packages/hench/src/agent/lifecycle/cli-loop.ts`
- `packages/hench/src/agent/lifecycle/token-usage.ts`
- `packages/hench/src/cli/commands/run.ts`
- `packages/hench/src/cli/errors.ts`
- `packages/llm-client/src/create-client.ts`
- `packages/llm-client/src/cli-provider.ts`
- `packages/llm-client/src/codex-cli-provider.ts`
- `packages/llm-client/src/provider-registry.ts`
- `docs/guide/configuration.md`
- `docs/packages/llm-client.md`

OpenAI docs:

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex command line options: <https://developers.openai.com/codex/cli/reference>
- Codex config reference: <https://developers.openai.com/codex/config-reference>
- Codex `AGENTS.md` guide: <https://developers.openai.com/codex/guides/agents-md>
- Codex MCP guide: <https://developers.openai.com/codex/mcp>
- Codex approvals and security: <https://developers.openai.com/codex/agent-approvals-security>
- Codex non-interactive mode: <https://developers.openai.com/codex/noninteractive>

Anthropic docs:

- Claude memory / `CLAUDE.md`: <https://code.claude.com/docs/en/memory>
- Claude settings: <https://code.claude.com/docs/en/settings>
- Claude MCP: <https://code.claude.com/docs/en/mcp>
- Claude common workflows / structured CLI output: <https://code.claude.com/docs/en/common-workflows>
