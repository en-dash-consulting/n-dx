---
id: "0e20da64-ab1c-49ac-991e-bbd79a79c2b3"
level: "task"
title: "readWebVersion memoizes its own failure, pinning the reported version to \"unknown\""
status: "completed"
priority: "low"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-01-followup"
  - "fixed-in-pr-02"
source: "code review of PR #359, 2026-09-11"
startedAt: "2026-09-11T13:10:46.676Z"
completedAt: "2026-09-11T13:21:03.252Z"
endedAt: "2026-09-11T13:21:03.252Z"
resolutionType: code-change
resolutionDetail: >-
  readWebVersion() in packages/web/src/server/routes-status.ts no longer
  memoizes "unknown" on a failed read — only a successfully parsed version
  string populates cachedVersion, so a transient read failure (EMFILE, a
  not-yet-ready mount) is retried on the next call instead of pinned for the
  life of the process. A successful read is still memoized (single read).
  Added packages/web/tests/unit/server/routes-status-version-cache.test.ts
  covering fail-then-succeed, succeed-then-fail, and single-read
  memoization via a mocked node:fs.readFileSync.
acceptanceCriteria:
  - "A transient read failure does not populate the cache: a later call that succeeds returns the real version."
  - "A successful read is still memoized — the file is read once, not on every request (assert with a spy or a call counter)."
  - "Unit test drives both orders: fail-then-succeed returns the real version, succeed-then-fail keeps returning the cached real version."
  - "Best fixed alongside a1c9febd so the version assertion and the caching fix land together."
description: "Severity: low. Found by review of PR 1 (commit eec286d4). Fixed on the PR-2 branch.\n\nFAILURE SCENARIO\nreadWebVersion() in packages/web/src/server/routes-status.ts caches into a module-level `cachedVersion` and guards re-entry with `if (cachedVersion) return cachedVersion;`. The catch assigns the sentinel string \"unknown\", which is truthy, so a failure is cached exactly like a success and is never retried for the life of the process.\n\nConcretely: the first GET /api/status arrives during a startup burst in which readFileSync of package.json fails transiently — EMFILE under descriptor pressure, or a slow network mount not yet ready. cachedVersion becomes \"unknown\"; every later request short-circuits on the truthy check and keeps returning \"unknown\" even though the file has been readable for hours. The PR-7 dashboard footer then renders \"n-dx unknown\" until the server restarts.\n\nRelated: item a1c9febd-2f08-4d83-bdf8-670b57b05bd3 covers the fact that no test can currently tell \"unknown\" from a real version. These are complementary — that one adds the assertion, this one stops a transient failure becoming permanent — and are best fixed together.\n\nSOLUTION\nCache only successful reads: in the catch, return \"unknown\" WITHOUT assigning cachedVersion, so the next call retries. Keep the successful-read memoization as is (the file does not change under a running process)."
lastModified: "2026-09-11T13:21:03.252Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
