---
id: "64cf5020-7d7e-4ba9-b964-0ee9b77a18c0"
type: "change"
title: "Language-pack fixtures and goldens are not pinned to LF, so a Windows CRLF checkout fails the golden comparison"
slug: "language-pack-fixtures-and-goldens-are"
intent: "checkGolden compares the serialized golden byte-for-byte with the file on disk, and captured text and positions depend on fixture line endings. .gitattributes pins only .rex/.hench/.sourcevision outputs, so with core.autocrlf=true on the Windows CI runner, packages/sourcevision/tests/fixtures/language-packs/** golden.json and sources check out as CRLF."
acceptanceCriteria:
  - "A .gitattributes rule pins packages/sourcevision/tests/fixtures/language-packs/** to eol=lf (and any gitattributes-pins policy test knows about it)"
  - "On a CRLF checkout of a pack fixture, the golden comparison still matches"
touches:
  - "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "tests"
source: "ndx-adversarial-review"
---
