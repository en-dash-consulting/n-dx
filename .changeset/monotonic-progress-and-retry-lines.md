---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
---

CLI progress counters no longer appear to move backwards, and LLM rate-limit
retries print as their own line instead of overwriting whatever progress line
was on screen.

`@n-dx/llm-client` adds a `ProgressReporter` (`createProgressReporter`) that
turns phase-qualified counters into a running total — switching phases or
batches never produces a lower displayed number than was already shown — plus
`printRetryLine`/`formatRetryLine`, which print rate-limit retries in the
`retry n/m: <reason>` form on their own line and redraw the active progress
line afterward. `api-provider.ts`, `cli-provider.ts` and
`codex-cli-provider.ts` all route their default rate-limit message through
it, replacing the old `Rate limited — retry in Ns… (attempt n of m)` text.

`sourcevision analyze` registers a reporter for the life of the command
(including recursive `--deep` sub-analyses) and uses it for the zone
enrichment pass counter, which previously restarted at pass 2 for every
`--deep` sub-package even after a parent analysis had already shown a later
pass number. `hench run` registers a reporter for a task's whole attempt
sequence so the `Turn N/maxTurns` banner never prints a lower turn number
after a plan-mode respawn restarts the spawn from turn 0 — the persisted
`run.turns` accounting is unaffected, only what gets printed.
