---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Assisted skill runs now record what they cost, instead of zero.

`hench record` writes the run entry for work driven through a skill rather than a spawned agent. Those entries carried empty token usage, on the stated grounds that "Claude Code does not expose its own token consumption to the running skill". That holds for the tool surface and not for the filesystem: Claude Code writes a JSONL transcript per session in which every assistant message carries the API's `usage` object, and it exports `CLAUDE_CODE_SESSION_ID` to the tools it runs. So the numbers were readable all along, and `ndx usage` plus the dashboard's per-item rollup were under-reporting every skill-driven task by its entire cost.

Usage is now read from that transcript by default. Two things make the attribution honest rather than merely non-zero:

- **Only the delta.** One session routinely completes several tasks — the session this was built in completed four — so a per-record session total would count the same tokens once per task. A watermark per session lives in `.hench/usage-cursors/`, and each record claims only what accumulated since the last one. It survives transcript compaction by falling back from message uuid to a count, and says when it did.
- **Only after the work started.** The watermark cannot help the FIRST record in a session, which would otherwise claim everything spent before the task began. Measured against a live session: 549 messages and 127M cache-read tokens for one task. `--startedAt` now doubles as the earliest spend a record may claim, and `/ndx-work` captures it when it marks the task in progress.

Precedence is explicit `--input-tokens`/`--output-tokens`/`--cache-*-tokens` flags, then the transcript, then zeros. A missing or unreadable transcript never fails the record — an unrecorded run is worse than one missing its tokens — and the command reports which happened. `--no-tokens` opts out; `--session` and `--transcript` override discovery.

The `assisted` flag keeps its meaning as provenance (skill vs agent) rather than "no usage", and `turns` is now the transcript's message count, which is a real API-call count.

Skills that mutate state — `/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config` — record their runs as a documented step. Planning-style skills record against `skill:<name>`, which `get_token_usage` reports in its existing `orphans` bucket: work that produced many items should not be charged to one of them.

Also fixes a test-isolation hazard this created. `CLAUDE_CODE_SESSION_ID` is exported to `pnpm test` as well, so the suite began reading the ambient live transcript and asserting against numbers that change between runs — green in CI, unreproducible locally. `tests/setup-session-env.js` clears it in every worker, the same shape as the existing `setup-color-env.js` and for the same reason.
