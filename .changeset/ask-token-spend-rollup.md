---
"@n-dx/web": patch
---

Account for SourceVision Ask token spend in the usage rollup.

An ask was the one place n-dx spent tokens without leaving a trace: a hench run
writes `.hench/runs/<id>.json`, a rex command writes an `execution-log.jsonl`
entry, an analysis writes its totals into `manifest.json` — an ask wrote
nothing, so the dashboard's own model spend was invisible in the very view that
reports token usage.

Each ask now appends vendor, model, input, output, and both cache counters to
`.sourcevision/ask-usage.jsonl`, which `/api/token/*` reads alongside the three
existing sources. A failed or timed-out ask is recorded too, with its
classified reason — dropping it would make a run of timeouts look free. Writing
the record is best-effort and never turns an answer into an error.

Spend is booked against the `sv` package under its own `ask` command rather
than a fourth top-level package bucket: every grouping here already keys on
`package:command`, so `sv:ask` reads as its own line next to `sv:analyze` and
`hench:run` in the by-command view, while a new package value would mean
changing the `rex | hench | sv` triple that the aggregate types, the viewer,
and rex's mirrored types all spell out.

The aggregation cache now fingerprints the ask log as well. Without that, spend
written by the same server process that serves the token-usage routes would sit
on disk unread until an unrelated source happened to change.
