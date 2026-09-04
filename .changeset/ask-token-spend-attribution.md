---
"@n-dx/web": patch
"@n-dx/core": patch
---

Attribute SourceVision Ask token spend in the LLM Utilization view

Every Ask call spent real tokens from a surface with no accounting path. Hench
runs land in `.hench/runs/` and roll up per PRD item; rex and sourcevision
report through their own artifacts. The dashboard's own spend reported nowhere,
so the one view whose job is to report the bill was blind to its own.

Each call is now appended to `.n-dx-web-usage.jsonl` with vendor, model, input,
output, cache-creation and cache-read tokens, plus how the call ended. The
utilization aggregation reads it as a fourth package bucket, `web`, rendered as
"Dashboard" — its own colour, donut slice, filter option and command row, so it
stays separable from hench run spend everywhere the view breaks down by
package. Asks are not task-scoped, so the spend is a dashboard bucket rather
than being attributed to whichever PRD item happened to be selected.

Failed calls are recorded too, with the call counted and whatever the provider
reported. A provider that finishes after the ask timed out appends its counts
as a second, call-free record, so late tokens are neither lost nor
double-counted as a second call. A call that never reached a provider (no
analysis, unconstructible client) is deliberately not recorded — the ledger
counts calls, not intentions.

Cache tokens are now reported in this view rather than hidden, consistent with
the hench/rex decision. The server had always counted and priced them
(`estimateCost` charges cache writes at 1.25x input and reads at 0.1x), but the
viewer's local copy of the wire shape omitted the fields and totalled only
input + output — so "Total Tokens" disagreed with the "Est. Cost" beside it, and
on a cache-heavy run most of the bill had no visible line. Cache write/read now
appear as headline figures, as columns in the vendor-model and command tables,
and as their own cost lines.

The aggregation cache also fingerprints the ledger, so an answer's cost appears
without waiting for an unrelated source to change.
