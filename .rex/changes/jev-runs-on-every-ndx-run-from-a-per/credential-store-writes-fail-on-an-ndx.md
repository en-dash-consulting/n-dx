---
id: "94595998-4f73-4c75-af45-6a7d01e9c8ac"
type: "task"
title: "Credential store writes fail on an ndx home whose filesystem has no hard links"
slug: "credential-store-writes-fail-on-an-ndx"
description: "Severity: medium. Verdict: should-fix. Introduced by task e687795c (lock and guard created filled).\n\nFailure: put the ndx home (NDX_HOME) on a filesystem or share where node:fs linkSync rejects hard links with ENOTSUP, EOPNOTSUPP, ENOSYS, EPERM or EXDEV (exFAT/FAT volumes, macOS smbfs mounts). createFilled at packages/llm-client/src/credential-store.ts (createFilled, ~line 1021) throws on linkSync, so every setCredential/unsetCredential (`ndx config credentials.*`, llm.*.api_key writes, the one-time .n-dx.local.json import) fails. The previous open(..., 'wx') lock worked there. Reads are unaffected.\n\nReachability: only with a non-default NDX_HOME on such a filesystem; the default ~/.ndx is local. No capability check exists; unit and e2e tests run on local disks where link succeeds.\n\nPrecedent: rex hit the same defect (change 3290ab84) and fixed it in packages/rex/src/store/file-lock.ts with a directory-plus-renamed-owner-file fallback selected only on UNSUPPORTED_LINK_CODES. llm-client cannot import rex (foundation tier), so the protocol would be reimplemented here.\n\nOptions: (1) Recommended: the same directory fallback — mkdir(lock) publishes exclusivity, then rename a filled temp to <lock>/owner.json; an owner-less directory is treated as contended, never instantly stale; inspect/reclaim/remove learn the directory form. Cost: moderate, plus tests with an injected link error. Risk: reintroducing the empty-publication race if the owner-less directory gets an age rule. (2) Fail with a precise error naming the filesystem limitation and remedy (move NDX_HOME). Cheap, but drops compatibility the previous lock had. Do not fall back to open 'wx' + write: that brings back the empty-lock window this task closed."
acceptanceCriteria:
  - "A unit test that makes linkSync throw ENOTSUP (and EPERM, EXDEV) currently fails because setCredential throws; after the fix the write either succeeds through a fallback or fails with an error naming the filesystem limitation and NDX_HOME remedy"
  - "No fallback ever exposes a lock or guard that another writer can judge stale while its holder is alive"
  - "Hard-link publication stays the fast path and the cross-process writers e2e test still loses no update"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
