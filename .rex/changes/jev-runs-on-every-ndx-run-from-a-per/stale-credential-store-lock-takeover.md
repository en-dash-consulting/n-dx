---
id: "bb93e6fd-fe6a-418e-975c-746b0afacbd0"
type: "task"
title: "Stale credential store lock takeover keeps mutual exclusion"
slug: "stale-credential-store-lock-takeover"
description: "Should-fix from the #942 review. takeOverStale in packages/llm-client/src/credential-store.ts renames the lock aside before knowing whose it is. Sequence: B judges a dead holder's lock stale; A takes it over first and creates a live lock; B renames A's live lock aside, leaving lockPath missing; C's openSync(lockPath, 'wx') succeeds in that gap; B's linkSync fails with EEXIST (swallowed); A and C both run the read-modify-write and one write is lost. Repro: a lock holding {\"pid\":999999} and 10 processes calling setCredential at once lost an entry in 19 of 30 runs. Related: an empty lock (writer killed between openSync and writeSync) is never judged stale, so every later write times out after 10 s until the lock is deleted by hand. Fix options: only remove the stale lock if its content still equals the judged content without ever leaving lockPath empty under a live holder (e.g. a short-lived O_EXCL takeover guard file), and treat an empty lock older than a threshold (mtime) as stale."
acceptanceCriteria:
  - "Starting from a lock held by a dead PID, N concurrent setCredential calls with distinct names always leave all N entries (repeated-run test)"
  - "A live lock taken over by one writer is never removed or bypassed by a second writer that judged the old lock stale"
  - "An empty lock file older than a threshold is taken over instead of timing out every write"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "llm-client"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
