---
id: "f09a1259-957e-41b2-b650-8ae3b134e1a3"
type: "change"
title: "ndx stop treats a server owned by another user as stale and deletes its pid and port files"
slug: "ndx-stop-treats-a-server-owned-by"
intent: "packages/core/cli.js (~935) decides whether the background server runs with web.js `isProcessRunning`, which treats EPERM as not running. When the pid file names another user's live process, stop reports \"stale\" and deletes the pid and port files; the \"stop-failed\" EPERM branch (~951) can then only fire in a race.\n\nReachable: on shared machines or after a pid is reused by another user's process.\n\nFix options: (1, recommended) treat EPERM as alive in this probe (as child-lifecycle's isPidAlive does) and report stop-failed; small.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "ndx stop on a pid owned by another user reports that it could not stop it and leaves the pid and port files in place"
  - "A unit test stubs process.kill to throw EPERM and asserts the stop-failed outcome"
touches:
  - "1a326041-9ce2-490e-80ae-55fbdaf81543"
priority: "low"
source: "ndx-adversarial-review"
---
