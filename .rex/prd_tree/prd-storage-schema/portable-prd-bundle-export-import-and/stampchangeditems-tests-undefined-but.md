---
id: "284a3e0a-7182-43b4-9e03-6182442fc631"
level: "task"
title: "`stampChangedItems` tests `!== undefined` but its consumer tests truthiness, so `lastModified: null` defeats the repair"
status: "pending"
priority: "high"
tags:
  - "pr-review"
  - "reviewer:ryrykeith"
  - "severity:high"
  - "sync"
  - "merge-blocker"
  - "regression"
source: "ndx-capture"
acceptanceCriteria:
  - "`stampChangedItems` treats a falsy `lastModified` (null, empty string) the same way its consumer `isModifiedSinceSync` does — as absent"
  - "An imported item carrying `lastModified: null` and a `lastModifiedBy` ends up on disk with a real timestamp and its original author preserved"
  - "`isModifiedSinceSync` returns true for that item, so its first sync pushes rather than pulls"
  - "A test drives the null case through a real import, not just a direct call to the stamping function"
  - "Any other guard on the same field that tests `undefined` rather than truthiness is either corrected or documented as deliberate"
description: "Found by code review at 9191f0b2, reproduced end to end. Flagged as fix-before-merge. This is a regression in the fix committed as d826397d (\"fill only the missing half of a stamp\"), which was written to close exactly the hole it leaves open here.\n\n`stampChangedItems` guards with `if (item.lastModified !== undefined) continue;`, but its consumer `isModifiedSinceSync` opens with `if (!meta.lastModified) return false`. So `null` and `\"\"` are \"no timestamp\" to the reader and \"has a timestamp\" to the guard, and the repair skips precisely the items that need it.\n\nReproduced: a bundle item with `\"lastModified\": null` and a `lastModifiedBy` imports successfully, and the stored file has a `lastModifiedBy` line and no `lastModified` line at all. Three checks all miss it:\n\n- `PRDItemSchema` is `.passthrough()` and never declares `lastModified`, so the null parses fine.\n- `defaultTimestampFromExport` tests `=== undefined` and skips it.\n- The `stampChangedItems` guard tests `!== undefined` and skips it.\n\nThe null is then dropped by the frontmatter emitter, so from the next load the item reads as pre-existing and unchanged and can never acquire a stamp. It is never pushed to a remote and is overwritten by the remote's value on the next pull — the permanent sync invisibility that commit exists to prevent, reached by a different door.\n\nFix is one character: `if (item.lastModified) continue;`.\n\nReachability is narrower than the sibling findings — `rex export` never emits a null — so this needs a hand-authored bundle or one from a third-party tool. It is captured at high priority anyway because the cost is a single character and the failure is silent and permanent. Worth checking whether the same `!== undefined` / truthiness split exists at the other bookkeeping read sites while fixing it."
lastModified: "2026-09-11T02:57:24.464Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
