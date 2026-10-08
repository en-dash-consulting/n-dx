---
id: "ab9eeda9-2419-4ef0-bff4-4c20251758aa"
level: "feature"
title: "v2 schema and rules before the freeze"
status: "completed"
priority: "critical"
startedAt: "2026-10-08T00:44:08.183Z"
completedAt: "2026-10-08T01:01:44.230Z"
endedAt: "2026-10-08T01:01:44.230Z"
acceptanceCriteria: []
description: "Schema and rule corrections from the pre-freeze review of PRs 10, 11 and 12 (2026-10-07), landed from main before those PRs continue, so each can merge main and see them (the PR 27 pattern). The freeze allows optional fields in a 1.x minor but not a changed meaning, a removed enum value or a replaced field, so those land here. Small, single-lane, strongest tier with --review (claude-opus-5-5 run and review).\n\nRoadmap PR 30 · wave 1 · lane rex-domain (schema)."
lastModified: "2026-10-08T01:01:44.996Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A change that adds the same target twice passes the v2 rules, hiding a self-parent on the duplicate](./a-change-that-adds-the-same-target.md) | pending |
| [Add the v2 schema fields decided before the freeze](./add-the-v2-schema-fields-decided.md) | completed |
| [An amendment's type is accepted on any delta and may be missing on an added one](./an-amendment-s-type-is-accepted-on-any.md) | completed |
| [An open change may modify, touch or add under a retired product node without a v2 rule finding](./an-open-change-may-modify-touch-or-add.md) | pending |
| [Fix the v2 rules for applied changes, Inbox changes, fixes and reference integrity](./fix-the-v2-rules-for-applied-changes.md) | completed |
| [Reject cyclic same-change parents and wrong-kind references in the v2 rules](./reject-cyclic-same-change-parents-and.md) | completed |
