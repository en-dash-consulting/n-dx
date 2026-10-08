---
id: "127a68ab-c1e8-4fef-aa08-53cbe95f2a33"
level: "task"
title: "Place as amends on an amending title verb or an explicit Relation marker"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Fix after dd0b540e (run 1f7ed836, commit 5d77654e0), decided 2026-10-08 (Ryan). placementRelation in packages/rex/src/core/placement.ts returns amends only when the title opens with an amending verb AND the intent carries a 'Relation: amends' line. Nothing writes that line, so every change places as touches. The intended rule is either signal, with the explicit line winning:\n- An intent line 'Relation: amends' or 'Relation: touches' decides the relation outright, in either direction.\n- Without such a line, a title that opens with an amending verb (AMENDING_VERBS) places as amends.\n- Otherwise touches.\n- fix: true and the code-health tag still force touches, even over a 'Relation: amends' line.\nTests: 'Add Jira import' with no marker places as amends; 'Rename the lock helper' with intent 'the new store layout makes the old name misleading' places as touches; 'Add a retry' with 'Relation: touches' places as touches; 'Rename the lock helper' with 'Relation: amends' places as amends; a fix: true change with 'Relation: amends' places as touches. Update the doc comment. Closes capture 4d097853. Stay in core/placement.ts and its tests; commit the work."
lastModified: "2026-10-08T05:14:21.972Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
