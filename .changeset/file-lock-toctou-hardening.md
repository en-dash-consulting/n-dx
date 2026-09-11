---
"@n-dx/rex": patch
---

fix(rex): close two cross-process TOCTOU holes in the PRD file lock

Follow-up to the dead-PID-only staleness fix: auditing the flaky
`import-bundle-transaction` failure surfaced two remaining ways a live
writer's lock could be deleted under full-suite load, each admitting a second
writer into the critical section — the exact lost-update the stale-save guard
keeps catching.

- **Mid-creation reads.** `tryAcquire` creates the lock with `writeFile(…,
  {flag:"wx"})` — open, then write. A waiter reading between the two syscalls
  saw an empty file, decoded it as "malformed = stale", and unlinked a live
  writer's lock. Malformed is now confirmed after a 100ms grace re-read: a
  corpse stays malformed, a mid-creation lock becomes valid.

- **Cleanup races.** Two waiters could both judge the same corpse stale; the
  faster one unlinked it and created its own lock, and the slower one's
  unlink then landed on the fresh lock. Stale removal is now claim-by-rename
  to a waiter-unique tombstone (exactly one racing rename succeeds) with
  content verification against the bytes the staleness judgment was made on —
  a removal armed with a stale judgment can no longer delete a lock that has
  since been replaced.

Both paths are pinned by new unit tests in `file-lock.test.ts`, including the
late-cleaner regression and the mid-creation window frozen in place.
