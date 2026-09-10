---
id: "497fb690-3f3b-438d-8643-6aa162bd7aaf"
level: "task"
title: "Export in-tree guard stops one directory short of the legacy PRD backend paths"
status: "in_progress"
priority: "high"
tags:
  - "pr-review"
  - "severity:high"
source: "pr-review"
startedAt: "2026-09-10T19:23:30.052Z"
acceptanceCriteria:
  - "assertOutsideTree refuses any --out path inside .rex/ for both bundle and narrative formats"
  - "Error message names the refused directory and suggests a path outside it"
  - "Tests: export --out=.rex/prd.json and --format=narrative --out=.rex/prd.md both fail without writing"
description: "Verdict: valid (verified). assertOutsideTree (packages/rex/src/cli/commands/export.ts:148) compares only against .rex/prd_tree/. But FileStore.loadDocument (store/file-adapter.ts:411) falls back to loadLegacyDocument — preferring .rex/prd.md, then .rex/prd.json — whenever the tree directory is absent.\n\nReachable outcomes: (1) `rex export --out=.rex/prd.json` passes the guard; a bundle envelope carries schema/title/items so PRDDocumentSchema (passthrough) accepts it — on a checkout where the tree is missing (gitignored tree, pre-migration project), the transport artifact silently becomes the PRD backend, contradicting the CLAUDE.md carve-out added in this PR (\"never read as a PRD backend\", \"refusing an output path inside the tree is enforced in code\"). (2) `rex export --format=narrative --out=.rex/prd.md` plants prose at the preferred legacy path; the markdown parser then throws, blocking every rex command on that checkout.\n\nSolution: widen assertOutsideTree to refuse any path inside .rex/ itself — there is no legitimate reason to write an export into .rex/. Update the CLAUDE.md carve-out wording if needed."
lastModified: "2026-09-10T19:23:30.077Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
