# Codex assisted usage support

`n-dx hench usage mark` and `n-dx hench record` support Claude Code message
usage and Codex rollout JSONL envelopes: `session_meta`, `turn_context`, and
`event_msg` with `payload.type: token_count` and
`payload.info.total_token_usage`. `last_token_usage` is deliberately ignored.
`codex exec --json` output is a different format and is not supported here.

Codex discovery uses `CODEX_THREAD_ID`, or an explicit `--session`, and searches
`CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl`, then
`CODEX_HOME/archived_sessions/`. The default home is `~/.codex`. Ambiguous
matches require `--transcript`; discovery never selects another session by
recency. `--vendor=codex` selects Codex discovery explicitly. A rollout's
session metadata must agree with the selected session.

The cumulative input counter includes cached input; cached reads and optional
cache writes are separated from fresh input. Reasoning tokens are already
included in output. Replayed counter snapshots contribute nothing. Marks and
watermarks retain cumulative totals so a resumed transcript with a missing
prefix can still supply a delta. Nested claims are unioned before subtraction.
When positions disappeared, message counts are approximate, and diagnostics
are partial. Counts describe usage observations, not necessarily user turns.

Missing/unsupported counters and ambiguous resets are unavailable, not measured
zero. Such reads preserve the cursor and marks for recovery. A new session has
its own cursor; marks are not transferred between sessions. Start a new mark
after switching sessions. `--since` is supported only for Claude message
transcripts. Explicit token flags remain available for externally measured
usage. Normalized zero fields on unavailable records are compatibility
placeholders; consult `diagnostics.tokenDiagnosticStatus`.

The selected session's vendor is retained for unsupported transcripts and
explicit or disabled accounting; an unknown Codex model stays `unknown` rather
than inheriting a configured Claude model. A transcript whose vendor conflicts
with the selected session cannot overwrite marks or advance the watermark.

Protocol reference checked on 2026-11-16:
[OpenAI Codex protocol source](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
(`TokenUsage`, `TokenUsageInfo`). These formats are internal rollout formats,
not a promise of support for every Codex version or wrapper.

Evidence: synthetic store and command integration fixtures cover cumulative
counters, repeated records, three nested marks, missing prefixes, interrupted
JSONL tails, unavailable counters, resets, identity mismatches, archived
discovery, and session isolation. Fixtures contain no credentials or production
transcript content. No live session, account/model availability, or browser
flow was exercised. The configured CLI lives outside this task's permitted
project directory, so its version and live rollout behavior were not verified.

Retry diagnosis: the failed attempt recorded the prompt census with
`--allow-dirty`, yielding `02a61b204bb2-dirty`. The published-baseline test
requires a clean commit hash. Commit `685e6849d` already regenerated the census
from clean checkpoint `4ddd1667a`; the retry preserves that artifact and its
provenance instead of recording another dirty baseline. The census suite passes.

The retry's regression tests reproduced four failures in vendor provenance and
cross-vendor boundary protection before the fix. All fixtures are synthetic.

Validation on the retry: Hench build passed; five scoped usage suites passed
102 tests; six root suites passed 349 tests (`cli-dev`, `scheduler-startup`,
`instruction-alignment`, `changeset-body-policy`, `architecture-policy`, and
`domain-isolation`). The separate prompt-census suite passed 29 tests.
Live CLI evidence and CLI self-review remain outstanding under the
project-directory-only access restriction; no substitute vendor was used.
