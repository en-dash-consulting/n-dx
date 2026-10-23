---
id: "f9376f14-b575-4878-bec0-097c24f26970"
type: "capability"
title: "Epic-Scoped Slug Naming Convention for Folder-Tree Directories"
slug: "epic-scoped-slug-naming-convention-for"
statement: "The PRD store names each folder-tree directory with a deterministic slug derived from the item's title, at every level of the hierarchy: epics, features, tasks and subtasks."
criteria: [{"id":"c1","text":"The slug function shall produce lowercase, hyphen-separated names that contain no special characters or path separators."},{"id":"c2","text":"The slug function shall always produce the same slug for the same title."},{"id":"c3","text":"If a title exceeds 60 characters, the slug function shall truncate it at a word boundary and append the first 6 characters of the item ID."},{"id":"c4","text":"When two sibling items produce the same slug, the PRD store shall append a short ID suffix to keep their directory names distinct."},{"id":"c5","text":"The PRD store shall apply the slug naming convention to epic, feature, task and subtask items."}]
requirements: [{"id":"f9376f14-b575-4878-bec0-097c24f26970:c3","title":"If a title exceeds 60 characters, the slug function shall truncate it at a word boundary and append the first 6 characters of the item ID","description":"Linked to: packages/rex/tests/unit/store/slug-path-length.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["If a title exceeds 60 characters, the slug function shall truncate it at a word boundary and append the first 6 characters of the item ID."]}]
source: "smart-add"
---

Define and implement a deterministic slug-based naming convention for the full PRD hierarchy so that each directory name is derived from the PRD item title rather than an opaque ID. Folder paths will read as human-legible representations of the PRD tree: .rex/prd/<epic-slug>/<feature-slug>/<task-slug>/<subtask-slug>/.
