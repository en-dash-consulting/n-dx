---
id: "cbd9e418-7469-4444-a9c9-0eca62876c97"
level: "task"
title: "Reject Windows-reserved and Windows-invalid slugs before the v2 writer writes anything"
status: "completed"
priority: "high"
startedAt: "2026-10-07T20:26:01.556Z"
completedAt: "2026-10-07T20:32:18.096Z"
endedAt: "2026-10-07T20:32:18.096Z"
resolutionType: "code-change"
resolutionDetail: "Added exported isWindowsSafeSegment (folder-tree-serializer.ts, re-exported from store/index.ts); prd-model-writer assertSlug calls it in the planning pass, so the write is refused before any file is touched."
acceptanceCriteria: []
description: "From the PR #565 review (finding 2, medium). In packages/rex/src/store/prd-model-writer.ts, assertSlug (around line 255) rejects only empty slugs, a leading dot, path separators or NUL, and a leaf named index. Windows refuses device names whatever their case or extension: CON, PRN, AUX, NUL, COM1 to COM9 and LPT1 to LPT9 (so con.md and nul/index.md cannot be created). It also refuses names ending in a dot or a space, and the characters < > : double-quote | ? * and control characters. A node with such a slug passes planning and then fails partway through writePrdModel on Windows, after earlier files have been written. Fix: add one exported predicate for a Windows-safe path segment in the rex store (next to the slug helpers) and call it from assertSlug, so the check happens in the planning pass before any file is written. Export it so the coming v2 slug creation (migration and v2 add) can avoid producing these names; slug creation itself is not part of this PR. Do not change the v1 slugify or slugifyTitle output, because that would change SLUG_RULE_VERSION and send existing trees through migrate-slugs. Acceptance criteria: (1) writePrdModel refuses a model containing a slug of con, CON, aux, nul, com1, lpt9, a slug ending in a dot or a space, or one containing a colon or another Windows-invalid character, with an error naming the node id and the slug (tests); (2) the refusal happens before any file is written: the tree is byte-identical after the refused write (test); (3) ordinary slugs such as console, auxiliary, null-handling and com10 are still accepted (test); (4) the predicate is exported for future slug creation, and v1 slugify output is unchanged (existing slug tests stay green)."
lastModified: "2026-10-07T20:32:18.317Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
