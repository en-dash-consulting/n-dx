---
"@n-dx/hench": patch
---

Report cache tokens in the run summary, which understated input ~65,000x.

`formatTokenReport` printed only `tokens_in` and `tokens_out`. `tokens_in`
counts *uncached* input, so on a cached run it is a rounding error against the
real figure: a measured 83-turn run reported 534 there while reading 34.1M
tokens from cache and writing 876K — a summary that made a ~$24 run look free.

The counts were always correct on the run record, and `rex usage`, `hench show`
and the dashboard already read them; only this summary dropped them. It now
appends `cache_write` and `cache_read` after `tokens_out` (appended, not
interleaved, so line offsets stay stable for anything parsing the block), labels
the headline `(uncached)`, and widens the shared field to the largest value. A
run with no cache activity renders byte-identically to before.

Also: `getTokenAvailability` no longer reports a run whose only spend was cache
reads as "no data", and `hench show`'s separate Cache line is removed as
redundant — its absence from the `ndx work` summary is how the two diverged.
