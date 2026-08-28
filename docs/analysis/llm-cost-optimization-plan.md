# LLM Cost Optimization Plan

Scope definition for the `feat/llm-cost-optimizations` branch. Seven work items derived from
the token-spend audit and the routing/session-architecture design doc (2026-08). Each item
lists the audit findings it resolves and the concrete touch points.

## 1. Light-tier model for commit messages & rex mechanical calls

**Resolves:** audit H8, R5, C2 (partially) · design §04 T1 routes, §09 Haiku routing map

Route mechanical, structured, single-shot call sites to the light tier (`claude-haiku-4-5`):

- hench pre-run commit message (≤12 KB diff → 1 line) — `packages/hench/.../shared.ts:1134`
- rex sibling renames — `rename-resolve.ts:97`
- rex body merges — `reshape-reason.ts:376`
- rex group renames — `propose-group-renames.ts:155`
- rex consolidation guard (structured JSON in/out) — `consolidation-guard.ts:110`
- rex assessment pass — `reason.ts:1340`
- rex guided-mode clarify rounds — `guided.ts:100`
- sourcevision classification batches — `classify.ts:328`

Light-routed calls get strict output validation (schema/enum/length) with escalation to
standard on failure (design P3, §06). Keep the main hench agent loop, rex proposal
generation, and sourcevision deep-enrichment on standard-or-stronger (design P1).

## 2. Eliminate cold spawn per task

**Resolves:** audit H1 · design §08 (session architecture)

Every hench task today is a fresh `claude -p` spawn — re-paying harness prompt, CLAUDE.md,
skills, and repo re-exploration per task, even inside `--loop`/`--iterations`.

- **Warm-parent fork (default for claude-CLI):** one orientation session per loop/repo-state
  → `claude -p --resume <parentId> --fork-session` per task. Parent cached in
  `.hench/session-cache.json`, invalidated on sourcevision content-hash change,
  `parentMaxAgeHours` (default 24), or `ndx work --fresh`.
- **Sequential batching (fallback/alternative):** `hench.tasksPerSession` (default 4) — feed
  task N+1's brief as the next user turn instead of a new spawn.
- Config: `hench.sessionStrategy: "fork" | "batch" | "cold"`.

## 3. Artifact diet — reduce sequential-task and startup context usage

**Resolves:** audit S1–S3, H7, H10 · design §08.3, audit Tier-3 remediations

- Cap the `llms.txt` file-path table (~70% of the file today) — `llms-txt.ts:285-303`
- Cap the `CONTEXT.md` routes section — `context.ts:163-173`
- Compact/paginate the `sourcevision://zones` MCP resource (~80K tokens pretty-printed today) — `cli/mcp.ts:508`
- Size-guard `--context-file` (currently read whole, no limit — `run.ts:1177`); replace the
  untrimmed CONTEXT.md + full-PRD-tree pipe from `ndx work` with a distilled 5–10 KB primer
  (`context.distill`, cached by content hash).
- Brief diet: cap sibling lists, dedupe inherited requirements, summarize `workflow.md` — `brief.ts:135-255`

## 4. JSON discipline in prompts

**Resolves:** audit R7 · design §07.8

Drop `JSON.stringify(x, null, 2)` from prompt-embedded JSON (6+ sites: guard, decompose,
assess, modify, …) — billed indentation. Request compact/minified JSON output (no prose,
no fences); stop asking for restatements. Estimated 10–20% output-token reduction on rex
calls at zero risk.

## 5. Cap total spawns per task

**Resolves:** audit H2 · design §08.4 (retry-via-resume)

Today: 4 retry re-spawns × up to 3 plan-mode re-spawns = up to 12 cold spawns per run, and
the outer tracker allows 3 whole runs per task (`cli-loop.ts:1273-1425`, `run.ts:1579-1585`).

- Count plan-mode re-spawns against the retry budget.
- Enforce a hard cap on total spawns per task.
- Retry transient failures with `--resume <sessionId>` instead of a cold restart — the
  session already knows what it did, so the "re-inspect prior work" retry notice (and its
  cost) disappears.

## 6. Wire tiered model usage — parent model resolution per command and phase

**Resolves:** audit C2, C7 · design §05 (configuration), §04 (routing registry)

The light/standard/heavy tier machinery exists in llm-client but is unwired (2 callers,
heavy tier unreachable). Ship the class→tier→model resolution:

- `resolveTaskModel(taskClass, config)` in llm-client wrapping `resolveVendorModel`;
  built-in `DEFAULT_ROUTES` registry (design §04).
- Config surface in `.n-dx.json`: `llm.tiers.<vendor>.*`, `llm.routes.<class>` (exact +
  glob prefix), `llm.escalation.*`, `llm.effort.<class>`. Resolution order: CLI flag →
  route → class default → tier map → `TIER_MODELS` fallback; top-level `llm.model` becomes
  a `standard`-tier shorthand.
- rex: `spawnClaude(prompt, model)` → `spawnClaude(prompt, {taskClass})` — one edit at the
  `llm-bridge.ts:135` choke point covers all rex call sites.
- sourcevision: `callClaude` gains the same param; hench consults `agent.execute` /
  `git.commit-message`; the run-record `weight` field records the resolved tier.
- `ndx config` validators + help for the new keys; surface in the web UI (fixes C7 gaps).

## 7. Targeted retry model — replace dumb identical-prompt retries

**Resolves:** audit R4, C3 (partially) · design §06 (escalation ladder)

Rex currently resends a byte-identical prompt up to 3× on parse failure with no error
feedback (`modify-reason.ts:217`).

- Attempt 1: light/configured model + strict JSON schema on output.
- On invalid/refusal/semantic-check failure: attempt 2 on the standard model with the
  **same prompt plus the validation error appended**. No third attempt.
- Per-class semantic checks are pure code (children non-empty, verdict ∈ enum, two
  non-identical strings, …).
- Keep sourcevision's prompt-degradation ladder for context-overflow failures; escalate the
  model for capability failures — the failure class decides which ladder applies.
- Record `escalated: true` per call; a class escalating >20% of the time gets promoted to
  T2 by default.

## Measurement gate

All routing/session defaults are hypotheses until the CLI token-telemetry fix (PR in
flight) lands — live runs currently record `tokenUsage: 0/0`. Baseline a 5-task set, then
re-measure after each item; success criteria: ≥60% cost reduction on multi-task
`ndx work --loop`, ≥40% on `ndx plan`/`ndx ci`, quality flat or better.
