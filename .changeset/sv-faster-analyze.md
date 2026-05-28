---
"@n-dx/sourcevision": patch
"@n-dx/llm-client": patch
---

Make `sv analyze` (and especially `--full`) substantially faster.

- **Parallel enrichment batches.** Previously batches inside a single
  enrichment pass ran sequentially because each fed an `enrichedNames` hint
  forward to the next. That hint was advisory (collisions are resolved
  post-hoc), so batches now run via `Promise.allSettled`. On a typical
  7-zone repo this roughly halves Phase 4 wall-clock per pass.
- **Early-exit `--full` on convergence.** The pass loop now fingerprints
  zone identity + finding/insight counts after each pass and stops as soon
  as a pass produces no observable change. Stable codebases routinely run
  4 passes today where 1–2 do all the real work; the rest were dead weight.
- **`ZONES_PER_BATCH` 5 → 7.** Lets the typical small-to-medium project run
  in a single batch instead of two.
- **Tightened file-header excerpts.** Per-file cap 800 → 400 chars,
  per-batch budget 6 KB → 2.5 KB. Headers are still useful as ground-truth
  for "is this documented", but the previous budget inflated the full
  prompt enough to consistently miss the 90 s per-call timeout on slower
  networks.
- **Per-call timeout configurable + default bumped.** `claude` CLI
  invocations now default to 120 s (was 90 s) and respect
  `NDX_CLAUDE_PER_CALL_TIMEOUT_MS=<ms>` for users on slow networks /
  larger prompts. The 90 s cap was killing many legitimate-but-slow
  full-prompt completions before first byte (claude buffers stdout fully,
  so partial progress is invisible).
