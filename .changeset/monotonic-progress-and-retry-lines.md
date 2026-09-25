---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
---

Retries now print as their own `retry n/m: <reason>` line across the LLM
providers and hench, and `@n-dx/llm-client` gains a monotonic progress
reporter for counters that span phases or batches.

`@n-dx/llm-client` adds a `ProgressReporter` (`createProgressReporter`) that
turns phase-qualified counters into a running total — switching phases or
batches never produces a lower displayed number than was already shown — plus
`printRetryLine`/`formatRetryLine`, which print rate-limit retries in the
`retry n/m: <reason>` form on their own line and redraw the active progress
line afterward. `api-provider.ts`, `cli-provider.ts` and
`codex-cli-provider.ts` all route their default rate-limit message through
it, replacing the old `Rate limited — retry in Ns… (attempt n of m)` text.

`sourcevision analyze` registers a reporter for the life of the command
(including recursive `--deep` sub-analyses), and its spinners register
themselves as the active reporter while they own the terminal line, so a
rate-limit retry raised inside an enrichment or classification batch pauses
the spinner, prints its line, and redraws the spinner after it. The zone
enrichment pass number is deliberately left unclamped: it is an absolute
identifier (`--target-pass=N` names it) rather than a progress tick, so
forcing it upward would report the wrong pass.

`hench run` prints its own retries in the same form: the API loop's
`API returned 429, retrying in 1000ms...` becomes `retry 1/3: API returned
429, waiting 1000ms`, and the CLI loop's `Transient error on attempt n,
retrying in Xms...` becomes `retry n/m: transient error, waiting Xms`, where
`m` is the configured `retry.maxRetries`.
