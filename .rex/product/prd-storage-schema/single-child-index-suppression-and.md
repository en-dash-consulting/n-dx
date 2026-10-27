---
id: "9656fa3b-3e46-4951-b706-75f93fc1ddbb"
type: "capability"
title: "Single-Child Index Suppression and Front-Matter Deduplication Fix"
slug: "single-child-index-suppression-and"
statement: "The rex folder-tree serializer writes an index.md only when a folder contains two or more distinct named child files, so a single-child folder holds just its named file and no item's front-matter appears twice."
criteria: [{"id":"c1","text":"When a folder contains exactly one named child file, the folder-tree serializer shall write only that named file and no index.md."},{"id":"c2","text":"When a folder contains two or more distinct named child files, not counting index.md, the folder-tree serializer shall write an index.md for that folder."},{"id":"c3","text":"When a single-child folder is serialized and then parsed, the folder-tree parser shall return the same PRD item data that was serialized."},{"id":"c4","text":"The folder-tree serializer shall write each front-matter field (id, title, status, priority and the rest) of an item only once, never repeating it in both a named file and an index.md in the same folder."}]
requirements: [{"id":"9656fa3b-3e46-4951-b706-75f93fc1ddbb:c3","title":"When a single-child folder is serialized and then parsed, the folder-tree parser shall return the same PRD item data that was serialized","description":"Linked to: packages/rex/tests/unit/store/folder-tree-parser.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a single-child folder is serialized and then parsed, the folder-tree parser shall return the same PRD item data that was serialized."]}]
source: "smart-add"
---

The single-child compaction landed in the prior cycle but did not prevent index.md files from being created alongside a single named file. This feature enforces the invariant at the serializer level: an index.md must only be written when a folder contains two or more unique named child files. It also eliminates the duplicate front-matter that currently appears between a named file and its co-located index.md.
