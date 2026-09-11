---
"@n-dx/rex": patch
---

Fix a PRD-lock race that let two concurrent writers interleave.

`acquireLock` creates the lock file with `O_EXCL` and then writes its JSON, so
for a microsecond the lock file exists but is empty. A second process that hit
`EEXIST` and read it in that window got `""`, and `isLockStale` treated
unparseable content as stale — so it unlinked the live writer's lock and
entered the critical section alongside it. Two concurrent `rex import-bundle`
runs then interleaved and the second save was rejected by the stale-save guard
("this save would delete 1 item written after the document being saved was
loaded"), the intermittent `pnpm test` failure tracked as the rex flake.

`isLockStale` no longer treats an empty or unparseable lock as stale: a lock
mid-creation becomes readable within a retry, and a genuinely corrupt one keeps
failing to parse so the waiter times out loudly (naming the file to delete)
rather than interleaving silently — the same "reclaim only on proof the owner
is gone" rule the dead-PID path already follows. Reproduced 1-in-~15 before,
0-in-60 after; two regression tests pin that an empty and a garbage lock file
are waited on, not stolen.
