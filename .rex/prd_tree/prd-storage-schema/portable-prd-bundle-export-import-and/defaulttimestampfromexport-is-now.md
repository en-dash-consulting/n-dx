---
id: "5d5e3e41-6c63-4ed3-b3a4-9f40ac10e24e"
level: "task"
title: "`defaultTimestampFromExport` is now redundant and writes an unvalidated `exportedAt` to disk"
status: "pending"
priority: "high"
tags:
  - "pr-review"
  - "reviewer:ryrykeith"
  - "severity:high"
  - "sync"
  - "merge-blocker"
blockedBy:
  - "284a3e0a-7182-43b4-9e03-6182442fc631"
source: "ndx-capture"
acceptanceCriteria:
  - "An unparseable `exportedAt` (e.g. \"yesterday\") can no longer reach `lastModified` on disk — either because the helper is gone, or because `parseBundle` rejects the bundle"
  - "A future-dated `exportedAt` cannot produce an item that wins last-write-wins against every remote edit"
  - "Exactly one code path is responsible for filling a missing `lastModified` on import, and a comment says which and why"
  - "If the helper is kept, `parseBundle` rejects a bundle whose `exportedAt` is unparseable or in the future, with a BundleError naming the value"
  - "If the helper is deleted, an attribution-only imported item still ends up with a real timestamp and its original author, proven by a test through a real import"
  - "The existing behaviour that an item with neither field is stamped by the transaction is unchanged"
description: "Found by code review at 9191f0b2, reproduced against a freshly built dist. Flagged as fix-before-merge.\n\nTwo problems, and they compound: the weaker of two overlapping fixes is the one that wins.\n\n**Redundant.** Since `stampChangedItems` was rewritten (d826397d) to fill only the missing half of a stamp, an attribution-only new item already gets a real transaction timestamp and keeps its original author with no help from this function. But `defaultTimestampFromExport` runs first, inside `mergeBundle`, so the stamping then hits its `if (item.lastModified !== undefined) continue` guard and leaves whatever the helper wrote.\n\n**Unvalidated.** `parseBundle` checks only `typeof exportedAt === \"string\"`. Reproduced: a bundle with `\"exportedAt\": \"yesterday\"` imports successfully and writes `lastModified: \"yesterday\"` to disk. `isModifiedSinceSync` compares strings, and `\"yesterday\"` sorts above any ISO timestamp, so that item reads as dirty on every sync forever and wins last-write-wins against every genuine remote edit. A future-dated ISO stamp does the same without looking malformed.\n\nTwo routes, and the choice is a real one:\n\n- Delete the helper. Closes the injection at no cost and loses nothing, since the stamping now covers the case. The transaction timestamp is \"when this landed here\" rather than \"when the content was made\".\n- Keep the `exportedAt` default and validate it. The docblock's argument — the content is at least that old, and the author it names really did write it by then — is reasonable and gives a more honest timestamp than \"now\". But then `exportedAt` must be validated in `parseBundle` as a parseable, non-future date, and that validation is the actual work.\n\nEither is defensible; what is not defensible is the current state, where an unvalidated value preempts the validated path. Note this interacts with the sibling null-guard finding: both concern which code is responsible for filling a missing timestamp, and settling this one decides whether that responsibility sits in one place or two. Blocked on that finding, because deleting the helper concentrates responsibility in the stamping path, which should be correct before it becomes the only one."
lastModified: "2026-09-11T02:57:41.954Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
