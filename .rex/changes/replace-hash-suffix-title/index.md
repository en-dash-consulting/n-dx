---
id: "1e0029c2-5719-4cef-aae2-61d8400a7d0b"
type: "change"
title: "Replace Hash-Suffix Title Disambiguation with Rename-or-Merge Resolution"
slug: "replace-hash-suffix-title"
intent: "Currently when rex add encounters a conflicting (duplicate) title, it appends a hash/id suffix to disambiguate (e.g. 'Foo (abc123)'). This pollutes titles with non-semantic noise and defers the real decision. Replace this behavior so that when a title conflict is detected, the system either (a) renames both conflicting items to titles that better reflect their distinct descriptions, or (b) merges them following the existing reshape consolidation rules when they are genuinely duplicates. The hash-suffix addition path must be removed entirely from the add/reshape pipeline."
amends: [{"target":"11be7299-0ef9-4b4e-808a-a09e98fe708e","delta":"modified","summary":"Replace Hash-Suffix Title Disambiguation with Rename-or-Merge Resolution","base":"0d2d8f66cc2b6e2f7d6be8f8425d83f72582d25a470eea6505f9c874554b57af"}]
source: "smart-add"
---
