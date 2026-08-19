---
"@n-dx/hench": patch
---

Stop `RunChangeDetector` from missing a same-length run-file rewrite.

It decided whether a run file had changed by comparing mtime + size, which misses a whole class of edit on Windows: file timestamps advance in ticks, so a rewrite of the same LENGTH inside one tick leaves both values identical. Measured on NTFS — 163 of 200 back-to-back same-size rewrites produced a byte-identical `mtimeMs`, with gaps between consecutive distinct mtimes running up to 10ms. An equal-length edit to a run record (a taskId or status swap) therefore kept its stale contribution until some later change forced a re-read. ext4 records nanoseconds, which is why Linux never showed it.

mtime is now trusted only once it is older than a granularity bound. Inside that window the snapshot also carries a hash of the file's bytes and detection compares that; the hash is dropped as soon as the mtime ages out, so the steady state stays stat-only. The two new checkpoint fields are optional, so a checkpoint written by an earlier version still loads — its mtime is old by definition, so the absence of a hash correctly means "trustworthy".

This is the same defect fixed in web's `IncrementalTaskUsageAggregator`. The two implementations are deliberately kept as documented twins rather than sharing a helper: no module both packages can import is an appropriate home for a filesystem utility, and — unlike the `quoteWindowsToken` twin — these two never need to agree with each other, so there is nothing for a parity test to assert. Each side carries its own `utimes`-pinned test for the hazard instead.
