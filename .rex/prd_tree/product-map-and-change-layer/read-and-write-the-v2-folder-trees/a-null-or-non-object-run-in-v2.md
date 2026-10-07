---
id: "00b13c14-f522-4c48-9cac-ace0deb6e632"
level: "task"
title: "A null or non-object run in v2 frontmatter fails the whole node's intent parse"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "lane-rex-store"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The v2 parser loads a task whose frontmatter has `run:` with no value (null), reading it as no run block, and every other node in the tree loads"
  - "The v2 parser loads a task with a non-object run (string, array) with a warning naming the item id; the node's other fields are intact"
  - "Regression test: a tree with one such task still accepts writes to other items"
description: "Failure: SavedRunSettingsSchema (packages/rex/src/schema/v2.ts, the `run` field on ChangeIntentSchema and TaskIntentSchema) is `z.object(...).passthrough().optional()`. A hand-edited `run:` with no value parses from YAML as null, and a `run: heavy` parses as a string. Either one fails ChangeIntentSchema/TaskIntentSchema, and so NodeIntentSchema, for that node. This was confirmed with zod: `{run: null}` and `{run: \"x\"}` both fail. If the v2 reader validates whole nodes with NodeIntentSchema, one such block makes that node unreadable, and possibly the tree. That is the lock-out the run-settings contract exists to prevent.\n\nv1 avoids it in the parser. packages/rex/src/store/folder-tree-parser.ts (~line 901) drops a null or non-object run, warning \"Ignoring run on item id=…: expected a JSON object\", before schema validation runs.\n\nReachability: none today, because v2 is wired to nothing. It becomes reachable when the dual-read parser (this feature) lands.\n\nVerdict: should-fix, in the parser PR rather than in the schema PR (PR 27).\n\nOptions:\n(a) The v2 parser pre-filters `run` exactly as v1 does: drop null or non-object with a warning before NodeIntentSchema. Cheap, and it keeps the schema's \"loose object\" declaration. Recommended.\n(b) Widen the schema with a z.preprocess that maps null to undefined, and accept any value. This removes the reader's burden, but a non-object then reaches the run-settings rule; the rule already warns on it, since validateRunSettings fails on non-objects. The schema becomes less honest about the shape."
lastModified: "2026-10-07T16:19:14.805Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
