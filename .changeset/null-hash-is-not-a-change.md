---
"@n-dx/web": patch
"@n-dx/hench": patch
---

A run file that cannot be read is no longer treated as a run file that changed.

Both change detectors trust mtime only once it is older than the filesystem's timestamp granularity, and inside that window compare a hash of the bytes instead. `hashFile` returns null when the read fails, and both docblocks promised the caller treats that as "no usable hash" rather than as a change. Neither caller did: the comparison guarded the *previous* hash against null but not the new one, so a previously-hashed file whose read now failed compared `"abc" !== null` and was reported modified.

In the web aggregator that was the expensive direction to get wrong. "Modified" means subtract-then-re-read, and when the re-read failed too the contribution was dropped outright — so a momentarily unreadable run file silently lost its tokens from the per-task aggregate until something else touched it. Absence of evidence became a deletion. The hench detector only reports the change without mutating an accumulator, so the cost there was a spurious change flag.

Both now require *both* hashes to be usable before a difference counts. mtime and size already agree at that point, so nothing suggests a rewrite — only that this scan could not check, which is not the same thing. Each side gained a test that injects the read failure (reproducing it from the filesystem is platform-specific; the branch is not) and asserts the file's tokens survive it, with a precondition check so it cannot pass vacuously when no hash was being carried.

Fixed in both copies together, as the twins' shared rule requires. Note for anyone tracing this: there is no parity test between these two detectors and there was never meant to be — `incremental-task-usage.ts` explains why they are deliberately unshared and unpaired, unlike the `quoteWindowsToken` twins.
