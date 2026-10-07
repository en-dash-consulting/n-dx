---
"@n-dx/core": patch
---

`ndx ci`'s architecture-policy step no longer fails on every run of this
repository.

`ci.js` and `tests/e2e/architecture-policy.test.js` each kept their own list of
files allowed to import `node:child_process`. Nobody kept `ci.js`'s list up to
date, so it reported 26 violations that the test allowed. Both now read
`packages/core/child-process-allowlist.json`, where every entry carries a
reason. Agent worktrees and local harness scratch space are excluded from the
scan. A parity test fails if the two scanners ever disagree.
