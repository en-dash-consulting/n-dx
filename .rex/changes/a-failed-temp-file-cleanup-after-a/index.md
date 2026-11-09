---
id: "6697ab21-d3f1-427b-a8b0-059520d2f7da"
type: "change"
title: "A failed temp-file cleanup after a successful link leaks the credential store lock under a live PID"
slug: "a-failed-temp-file-cleanup-after-a"
intent: "Severity: medium. Verdict: out-of-scope (pre-existing since #956; surfaced by the #999 review).\n\nFailure scenario: in packages/llm-client/src/credential-store.ts createFilled, linkSync(tmp, path) succeeds (the lock is published with this writer's content), then the `finally` rmSync(tmp, { force: true }) throws — on Windows, EPERM/EBUSY when antivirus or the indexer holds the just-written temp file open without share-delete. createFilled throws after the lock exists. Before #999 the error escaped withStoreLock with no release; since #999 it is read as contention, so the writer polls, finds its own live-PID lock, and times out after lockTimeoutMs naming its own PID. Either way the update is lost and the lock stays held by a live PID: every later credential write, in any process, times out until this process exits (indefinitely for a long-running `ndx start`).\n\nReachability: setCredential / setHelperCredential / unsetCredential on Windows with a scanner holding new files; low probability, high impact while it lasts.\n\nOptions: (1) Recommended: once the link has succeeded, treat temp cleanup as best-effort outside the success path — return true and remove the temp file with a retry, never letting its failure turn a held lock into an error (a leftover private .tmp is harmless; optionally sweep stale `*.tmp` in the ndx home later). Cost: a few lines plus a test injecting a cleanup failure. (2) Catch post-link failures in createFilled and remove the just-published lock before rethrowing. Riskier: a removal by path is the kind the lock protocol avoids."
acceptanceCriteria:
  - "A unit test that makes the temp-file removal throw after a successful link shows the writer still holds the lock, runs its update and releases the lock (fails today: the write is lost and the lock remains)"
  - "No credential store lock is left behind holding the writer's live PID after any createFilled failure (test)"
touches:
  - "a63d1345-5167-4332-844a-0398aea517b1"
priority: "medium"
discoveredFrom: {"item":"6ce19e18-3b29-47f9-a1ae-251ac3e4031f","run":"f49df105-8647-4d77-bd51-fb1ab50f8f25"}
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "windows"
source: "ndx-adversarial-review"
---
