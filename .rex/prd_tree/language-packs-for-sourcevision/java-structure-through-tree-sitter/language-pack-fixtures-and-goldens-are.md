---
id: "64cf5020-7d7e-4ba9-b964-0ee9b77a18c0"
level: "task"
title: "Language-pack fixtures and goldens are not pinned to LF, so a Windows CRLF checkout fails the golden comparison"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "tests"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T01:20:29.083Z"
completedAt: "2026-10-08T01:23:14.629Z"
endedAt: "2026-10-08T01:23:14.629Z"
resolutionType: "code-change"
resolutionDetail: ".gitattributes pins language-packs fixtures to eol=lf; prd-line-endings e2e checks it"
acceptanceCriteria:
  - "A .gitattributes rule pins packages/sourcevision/tests/fixtures/language-packs/** to eol=lf (and any gitattributes-pins policy test knows about it)"
  - "On a CRLF checkout of a pack fixture, the golden comparison still matches"
description: "checkGolden compares the serialized golden byte-for-byte with the file on disk, and captured text and positions depend on fixture line endings. .gitattributes pins only .rex/.hench/.sourcevision outputs, so with core.autocrlf=true on the Windows CI runner, packages/sourcevision/tests/fixtures/language-packs/** golden.json and sources check out as CRLF."
lastModified: "2026-10-08T01:23:14.876Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
