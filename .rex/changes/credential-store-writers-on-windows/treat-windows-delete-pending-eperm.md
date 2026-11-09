---
id: "6ce19e18-3b29-47f9-a1ae-251ac3e4031f"
type: "task"
title: "Treat Windows delete-pending EPERM/EBUSY in the credential lock as transient contention"
slug: "treat-windows-delete-pending-eperm"
description: "Fix the Windows delete-pending race in the credential store's lock (packages/llm-client/src/credential-store.ts). Read the whole lock section first (withStoreLock around line 977-1000, createFilled ~1031, removeIfOwn ~1067, removeLock ~1075, inspectLock ~1106, readOwnerFile ~1146, lockIsStale, takeOverStaleLock ~1183, reclaimAbandonedGuard ~1209). Known failure points: (1) inspectLock and readOwnerFile treat only ENOENT as absent, so statSync/readFileSync of a lock, guard or owner.json that is being deleted throws EPERM/EBUSY out of the writer; (2) createFilled's linkSync to a path that is delete-pending can also fail with EPERM, which UNSUPPORTED_LINK_CODES currently reads as 'this volume has no hard links' and sends the writer down the mkdir fallback — check whether that misclassification is reachable and handle it. Required behaviour: on win32 only, an EPERM/EBUSY (and EACCES where it cannot be a real permission problem) from these lock-family operations is transient contention — the writer backs off and retries within the lock's existing wait budget, and never loses its update or throws; mutual exclusion must hold exactly as now (no writer may enter while another holds the lock, and the takeover guard's one-winner rule stays); a real permission error that persists past the wait budget still surfaces with the existing timeout message; POSIX behaviour does not change; a volume that truly lacks hard links still takes the mkdir path. Add fs seams to LockSeams (or a narrow injectable fs) so a unit test can make stat/read/link throw EPERM once and assert the writer retries and its update lands, and a test that a persistent EPERM still times out. Keep tests/e2e/credential-store-writers.test.ts unchanged. Add a patch changeset for @n-dx/llm-client that says Windows writers no longer fail when another process is removing the lock. Run the llm-client tests and the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code)."
acceptanceCriteria:
  - "A unit test with an EPERM injected once into a lock-family stat, read or link shows the writer retries and its update lands"
  - "A persistent EPERM still ends in the existing lock timeout message"
  - "POSIX behaviour and the mkdir fallback for volumes without hard links are unchanged (tests)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
