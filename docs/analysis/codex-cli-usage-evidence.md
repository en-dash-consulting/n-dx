# Codex CLI analysis usage evidence

Task: 6ea1141c-9080-44a8-8442-1d67846b8de0. Checked 2026-11-16.

The provider requests `codex exec --json` and independently reads `-o` for
its exact final text. It consumes only `turn.completed.usage`; item events
and session token-count snapshots are not additional spend. One invocation
runs one turn. Replayed terminal records replace snapshots, never add them;
regressing snapshots do not replace newer counters. Separate spawned attempts
are separate spend and their measured counters are added, including failures.
Cached input is subtracted from total input and reported as cache reads.

`usageStatus` on completion results and errors distinguishes measured,
unavailable, malformed and partial accounting. A missing measurement leaves
`tokenUsage` absent; a measured zero has explicit zero counters. Rex records
failed spend independently of successful command aggregates and records
incomplete/zero accounting diagnostics. Sourcevision records coverage and cache
counts in its per-class ledger and uses that ledger for the manifest total.
CLI and dashboard manifest readers retain cache counts for budget calculations.

## Official contract

The [OpenAI non-interactive documentation](https://developers.openai.com/codex/noninteractive)
(accessed 2026-11-16, redirects to ChatGPT Learn) documents JSONL output,
`turn.completed` with `input_tokens`, `cached_input_tokens`, `output_tokens`,
and the independent final-message output file. Reasoning tokens are not added
again to the output count. This documentation is protocol evidence, not proof
that the local account can execute a model.

## Automated evidence

- `llm-client/tests/unit/codex-cli-usage.test.ts`: fragmented input, replay and
  cumulative snapshots, invalid counters, missing usage versus measured zero,
  real child-process fake binaries, retries and terminal failure spend.
- `rex/tests/unit/analyze/llm-bridge-usage.test.ts`: failed spend is logged once;
  successful spend remains owned by the command.
- `sourcevision/tests/unit/analyzers/{claude-client,run-ledger}.test.ts`:
  error spend, cache pricing, and incomplete versus measured-zero accounting.
- `rex/tests/unit/core/token-usage.test.ts`: Sourcevision cache counts in CLI
  aggregates and events.
- `web/tests/integration/codex-usage-rollup.test.ts`: direct HTTP-handler invocation
  verifies dashboard cache totals and a budget crossed only by cache tokens.

## Installed CLI and outstanding evidence

Installed executable reports `codex-cli 0.167.0-alpha.3.2`. Its help exposes the
non-interactive CLI. An ephemeral read-only probe in a disposable project
subdirectory exited 1 before any JSON events: app-server initialization was
refused with `Operation not permitted`; diagnostic database writes were also
refused. No model response or measured usage was obtained. Account/model
availability therefore remains unverified.

`codex exec --json -s read-only -c approval_policy=never review --uncommitted`
also exited 1 during initialization with no events. Codex CLI self-review
remains outstanding. No Claude fallback was used.

Socket-based Web tests are excluded by repository configuration in this sandbox;
the direct-handler budget regression passed. Browser flows were not exercised.
The task must not be marked complete until live supported-CLI usage and Codex
self-review succeed in an environment where the CLI can initialize.
