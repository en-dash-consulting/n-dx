---
id: "fa5c117f-82da-4dc8-b0ba-68ede437b78c"
level: "task"
title: "Cascade robustness: model-alias expansion and config warning, visible CLI errors, ladder stops on non-retryable failures, --full skipped after the cascade, naming progress and concurrency"
status: "deferred"
priority: "medium"
tags:
  - "sourcevision"
  - "llm-client"
  - "llm"
  - "typesafe"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test: resolveModel expands sonnet-5, opus-5 and haiku-4-5 forms to catalog ids and leaves unknown strings untouched; ndx config warns on a model id outside the catalog"
  - "Unit test: a per-zone attempt failure logs the ClaudeClientError message, and a non-retryable unknown error ends the ladder after one attempt"
  - "Unit test: with the run ledger in cascade mode, --full runs no further enrichment passes and logs why; with --narrate --full the passes run as before"
  - "Unit test: generated-name fallbacks run with bounded concurrency and each emits a progress line"
  - "Live: sv analyze --full on a keyed repository completes in one cascade pass with the model id resolved from a sonnet-5 shorthand"
  - "pnpm --filter @n-dx/llm-client test and pnpm --filter @n-dx/sourcevision test pass"
description: "Found running `sv analyze --full` on a repository configured with `llm.claude.model: \"sonnet-5\"` (2026-09-22). Six defects, each independent; all were observed in one run.\n\n1. **Model alias expansion.** `MODEL_ALIASES` in `packages/llm-client/src/config.ts` expands `sonnet`/`opus`/`haiku` but not `sonnet-5`, `opus-5`, `haiku-4-5` style shorthands, so the configured string reaches the Claude CLI verbatim and fails with `[claude-code:unrecognized_model]`. Add the family-plus-version forms for every catalog model (derive from `TIER_MODELS`/`NEWEST_MODELS`, not a hand list), and make `ndx config llm.claude.model <x>` and the `Vendor: … Model: …` header warn when the resolved id is not in the catalog. Light-tier calls were unaffected because they ignore `llm.claude.model`, which is why only the per-zone narration failed.\n\n2. **Visible CLI errors.** `enrich-per-zone.ts` and `enrich-batch.ts` log only `err.reason` on a failed attempt; the reason for an unrecognised model is `unknown`, so the one diagnostic string was dropped. Print `err.message` (first ~200 chars) on the first failure of each zone/batch, as the judgment paths already do.\n\n3. **Ladder stops on non-retryable failures.** The per-zone and batch attempt ladders exist for prompt-size and timeout failures and degrade the prompt (full → medium → minimal). A `ClaudeClientError` with `retryable === false` and reason `unknown` fails identically at every size; treat it as terminal for that zone/batch instead of spending three spawns. On the observed run 6 zones × 3 attempts all failed the same way.\n\n4. **`--full` / `--target-pass` after a cascade.** The pass loop in `analyze-phases.ts` `runZonesPhase` re-runs `analyzeZones` for passes 2–4 regardless of mode; the cascade is one judged pass, so the repeats re-run naming (Jev cached, but the generated-name fallback is a text-model call and is not) and narration. When the run ledger mode is `cascade`, log one line and skip the extra passes; `--narrate --full` keeps today's behaviour.\n\n5. **Naming progress and concurrency.** `nameZonesBySelection` prints nothing between the cascade's first line and `[judge] zone naming: …`, and runs the generated-name fallback one Claude spawn at a time (`for … await`). On the observed run 23 of 25 zones escalated to generated names, silently, sequentially. Add a spinner per Jev batch and a progress line per fallback, and run fallbacks with the same bounded concurrency the per-zone narration uses (`MAX_CONCURRENT_ZONES`).\n\n6. **Calibration observations to record, not fix here.** On that repository 23/25 zones needed generated names — the deterministic candidates (package, dominant directory, archetype noun) do not fit feature-named directories such as `daily-standup` — and 40/41 heuristic findings landed in the 0.3–0.7 band, so the real-problem Noul was not discriminating there. Both belong with the re-run/band tuning work; note them in this item's log when it is worked."
lastModified: "2026-09-22T05:39:32.136Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
