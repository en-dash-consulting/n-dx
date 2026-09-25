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
(including recursive `--deep` sub-analyses), and its spinners register
themselves as the active reporter while they own the terminal line, so a
rate-limit retry raised inside an enrichment or classification batch pauses
the spinner, prints its line, and resumes it instead of interleaving with
the spinner's redraw. The zone enrichment pass number is deliberately left
unclamped: it is an absolute identifier (`--target-pass=N` names it) rather
than a progress tick, so forcing it upward would report the wrong pass.

`hench run` registers a reporter for a task's whole attempt sequence and
routes the `Turn N/maxTurns` banner through it. This is a guard, not a
behavior change: `agentLoop` is entered once per task and its turn loop
runs once, so the printed number is unchanged today. The persisted
`run.turns` accounting is not affected either way.
