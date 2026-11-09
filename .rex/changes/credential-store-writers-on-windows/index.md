---
id: "8dd961e5-f11e-487b-a559-062f1102839d"
type: "change"
title: "Credential store writers on Windows retry when another process is removing the lock"
slug: "credential-store-writers-on-windows"
intent: "Issue #999. The Windows CI job fails intermittently in packages/llm-client/tests/e2e/credential-store-writers.test.ts, 'credential store across processes > writers racing to take over a dead holder's lock lose no update': one racing writer throws EPERM and its update is lost. Seen on #997 (EPERM opening the per-identity `.takeover` guard) and on #998 (EPERM opening `credentials.json.lock` itself), so the race covers every read of the lock family, not only the guard. On Windows, opening or linking to a file another process has just unlinked (delete pending) fails with EPERM (sometimes EBUSY or EACCES) instead of ENOENT/EEXIST. The lock code arrived with the stale-lock takeover in #956."
acceptanceCriteria:
  - "No writer throws or loses an update when the lock, guard or owner file is being deleted on Windows (tests)"
touches:
  - "a63d1345-5167-4332-844a-0398aea517b1"
priority: "high"
source: "ndx-capture"
---
