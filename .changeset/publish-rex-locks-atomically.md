---
"@n-dx/rex": patch
---

Publish PRD lock files atomically so concurrent writers cannot enter the same
critical section.

The lock was created directly with `writeFile(..., {flag: "wx"})`, which made
its public name visible before the JSON body was written. A competing process
could read that transient empty file as malformed, reclaim the live lock, and
write alongside its owner. Lock acquisition now writes the complete body to a
unique sibling file and atomically links it into place; an existing public lock
still reports contention through `EEXIST`.
