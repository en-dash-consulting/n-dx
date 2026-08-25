---
"@n-dx/web": patch
---

Stop re-hashing unchanged run files on every dashboard poll.

The incremental task-usage aggregator trusts mtime only once it is older than the filesystem's timestamp granularity; inside that window it also carries a hash of the file's bytes, so an equal-length rewrite that reused the same mtime is still visible. The contract is that a file is hashed for the scan or two following its last write and never again, which requires re-snapshotting surviving files on every scan so the hash is dropped once the mtime ages out.

That re-snapshot loop sat *after* the no-change short-circuit, so on quiet polls — the common case — it never ran. A file first observed inside the granularity window kept `mtimeMayBeShared` set for the life of the process and was re-read and re-hashed on every poll, which is exactly the steady-state cost the snapshot design exists to avoid. On a busy `.hench/runs/` directory that is a full read of every recently-written run file, every poll, forever.

The loop now runs before the short-circuit. Its placement is bounded on both sides and the code says so: after categorisation, which needs the previous snapshots to compare against, and before the early return, because quiet scans are precisely the ones it has to run on. The short-circuit still guards the contribution work, so a quiet poll does no subtract/re-read — verified by a test, since re-snapshotting earlier must not turn a quiet poll into a re-aggregation.

Results were never wrong, which is why this was invisible from the outside: the defect was in what the cache retained and re-read. The three new tests therefore assert the private snapshot state and the hash-call count, including a precondition check so they cannot pass vacuously if the first scan lands outside the window.

hench's `RunChangeDetector` twin is unaffected — it has no short-circuit and rebuilds its checkpoint from every scan, so its hash drops on schedule.
