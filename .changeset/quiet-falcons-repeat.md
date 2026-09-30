---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

Report an unknown run cost as unknown, and scope the summary to the invocation

`priceRunLedger` discarded `resolveModelPricing(...).known` and priced every
bucket, so a local or unlisted model was charged at the fallback rates — which
are `claude-sonnet-5`'s, a real catalogue entry, so the guess read as a
measurement. `recordLLMCall` also folds a missing `tokenUsage` in as `0`, so a
provider that reported no usage priced to exactly `0`. The manifest's `costUsd`
is a single number with no room to say "partly", so one unknowable class now
leaves the field off the run entirely; `formatCost` renders that as
"not recorded".

`collectRunSummary` read `manifest.lastAnalysis` unconditionally, but that is
the last analysis the *project* ran, not the last one this command ran — and
most commands never run SourceVision. An interactive `ndx recommend .` after an
`ndx analyze .` therefore reported the analysis's calls, tokens and dollars as
its own, and `plan --file` read the same stale figures. It is now scoped by the
run's timestamp, the way the rex half already was.

`analyze` also spawns `sv narrate` detached and returns before that child
records a token, so the summary now says when a narrator this run queued is
still going, rather than presenting an incomplete total as final.
