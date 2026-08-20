---
"@n-dx/web": patch
---

Stop the dashboard's token-usage aggregation from missing a same-length run-file rewrite.

`IncrementalTaskUsageAggregator` decided whether a run file had changed by comparing mtime + size. On Windows that misses a whole class of edit: file timestamps advance in ticks rather than continuously, so a rewrite of the same LENGTH inside one tick leaves both values identical. Measured on NTFS — 163 of 200 back-to-back same-size rewrites produced a byte-identical `mtimeMs`, with gaps between consecutive distinct mtimes running up to 10ms. An equal-length edit to a run record (a taskId or status swap) therefore kept its old contribution, leaving tokens attributed to the wrong task until some later change to that file forced a re-read. ext4 records nanoseconds, which is why Linux never showed it.

mtime is now trusted only once it is older than a granularity bound. Inside that window the snapshot also carries a hash of the file's bytes and detection compares that instead; the hash is dropped as soon as the mtime ages out, so the steady state stays stat-only — a file is hashed for the scan or two after its last write and never again. Hashing unconditionally would have closed the same hole while defeating the point of an incremental aggregator.
