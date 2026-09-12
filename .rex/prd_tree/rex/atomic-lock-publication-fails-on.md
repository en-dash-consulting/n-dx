---
id: "3290ab84-1bc6-423f-940a-f11eb553728f"
level: "task"
title: "Atomic lock publication fails on filesystems without hard-link support"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test injects an unsupported hard-link error from link and currently fails because acquireLock aborts; after the fix it either acquires safely through a supported fallback or returns a documented capability error before any PRD mutation starts"
  - "Any fallback publication protocol never exposes an incomplete public lock that another writer classifies as stale"
  - "Normal hard-link publication remains the fast path and existing concurrent-writer tests continue to prove mutual exclusion"
  - "The supported-filesystem contract and operator remediation are documented if compatibility is intentionally restricted instead of restored"
description: "Severity: medium. Verdict: should-fix — introduced by task a63d1345, reachable only on filesystems that reject hard-link creation.\n\nFailure scenario: place a project on a filesystem or mounted share where node:fs link rejects file hard links with ENOTSUP, EOPNOTSUPP, ENOSYS, or an equivalent platform error. Every Rex mutation reaches tryAcquire at packages/rex/src/store/file-lock.ts and now throws before entering the critical section, although the previous writeFile with flag wx lock worked there. The caller receives a generic lock acquisition failure and no PRD operation can proceed.\n\nCoverage: Linux, macOS, and Windows CI exercise normal local filesystems where link succeeds; the new publication unit test mocks link but delegates to the host filesystem, so it never exercises the unsupported-primitive branch. There is no caller-side filesystem capability check.\n\nSolution options: (1) Recommended: add a second lock backend with an atomic primitive available on non-hard-link filesystems, selected only for recognized unsupported-operation errors, and preserve the invariant that incomplete metadata is never treated as stale. Cost is a small protocol abstraction plus platform tests; risk is recreating the empty-publication race if the fallback is not designed as a state machine. (2) Declare hard-link support as a storage requirement and fail at initialization with a precise diagnostic naming the filesystem capability and remediation. Lower implementation cost, but intentionally drops compatibility that existed before this change. Do not silently fall back to direct writeFile wx while malformed locks remain immediately reclaimable."
lastModified: "2026-09-12T22:46:15.153Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
