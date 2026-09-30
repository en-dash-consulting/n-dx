---
"@n-dx/hench": patch
---

Retry a session-cache rename that Windows refuses, and give each write its own temp file

`writeCacheFileAtomic` renamed a temp file over `session-cache.json` with no
retry. On Windows a rename onto a file any process holds open does not block —
it fails with EPERM, EACCES or EBUSY. The cache's lock serialises n-dx's own
writers and cannot serialise anyone else, and `readSessionCache` reads *without*
the lock by design, so a concurrent reader is enough on its own to make a
correctly locked writer throw. Backup, indexing and antivirus software hold
files the same way.

This was observed, not predicted: a full-suite run failed with `EPERM:
operation not permitted, rename '…session-cache.json.30212.tmp' ->
'…session-cache.json'` out of the production path, which in a real run would
have failed a batch-chain advance.

The rename now retries ten times at 50ms while the error is one of those three,
mirroring the `RM_RETRY` the test helpers already use for the same class. An
error that is not transient is not retried, and one that outlasts every attempt
still throws.

The temp name also carries a uuid alongside the pid. Two writers in one process
share a pid, so a pid-only name is one scratch file between them — the same
defect `preview.ts` had already fixed from the other direction, having no lock
at all.
