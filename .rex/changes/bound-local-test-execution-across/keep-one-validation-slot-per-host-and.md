---
id: "24e3c609-310d-41d1-b65f-26d8c55656cd"
type: "task"
title: "Keep one validation slot per host and only remove our own reclaim lock"
slug: "keep-one-validation-slot-per-host-and"
summary: "When two computers share a home folder over the network, their test runs can wrongly clear each other's slot and end up running at the same time. A rare race can also leave two runs both believing they hold the slot. This gives each computer its own slot and closes the race."
description: "PR 2 (#1034) review by Hal, 2026-11-14 (threads 4570835466 and 4570835472).\n\n1. [P2] The slot isn't per host (`packages/hench/src/process/validation-slot-dir.ts`, around line 16). If hosts share `~/.ndx` over NFS (the credential store treats a network home as supported, see `credential-store.ts` around line 1288):\n   - host B finds host A's pid absent locally and `bootedAt` different, so B reclaims and runs;\n   - then A2 judges B's record stale the same way;\n   - two runs on host A end up running at once, with no message.\n\n   Fix: resolve the slot directory to a per-host subdirectory, `<ndx home>/validation-slot/<host>/`, where `<host>` is `os.hostname()` lower-cased and reduced to `[a-z0-9._-]` (with a fallback name if empty). Keep the nesting token unchanged. Then:\n   - check that the sandbox grant in `packages/llm-client/src/sandbox.ts` (a subpath grant on `<ndx home>/validation-slot/`) still covers the subdirectory. It should, since the grant is a subpath; add or adjust a test if the profile tests assert the exact path. If the grant lives on a later branch, note it for PR 3 instead;\n   - update the protocol header in `validation-slot.ts` and any docs naming the path (TESTING.md, docs/guide/configuration.md, docs/packages/hench.md). PR 3's `scripts/lib/validation-slot.mjs` mirrors this later; don't create it here.\n\n2. [P3] The reclaim lock's `finally` (`validation-slot.ts` around line 397) unlinks whatever `reclaim.lock` is present, and its token is never checked. If a reclaimer dies holding the lock and two waiters A and B both judge it dead, both can end up believing they hold the slot (Hal's four-step trace in the thread). Fix: in the `finally`, unlink only when the lock's bytes still equal this process's lock, as the credential store's `removeIfOwn` does. Add a unit test where another process's lock replaces ours before the `finally`, and assert ours does not remove it.\n\nTests:\n- slot-dir tests for the per-host path, including hostname sanitizing;\n- the reclaim-lock ownership test above.\n\nOperator notes: run the slot unit tests, `validation-slot-dir` tests, `tests/integration/test-gate.test.ts` and the static root policy tests. Add a patch changeset for `@n-dx/hench`. No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "The slot directory is <ndx home>/validation-slot/<sanitized hostname>/, covered by tests, and docs and the protocol header name it"
  - "The reclaim lock's finally removes the lock only when it is still this process's, with a unit test for a replaced lock"
  - "A patch changeset for @n-dx/hench; slot and test-gate tests pass"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-2-host-slot"
  - "review-fix"
source: "ndx-capture"
---
