---
id: "d6419e1e-c15b-48ea-8e5c-cf781a65808e"
level: "task"
title: "Draft capability specs with a text model by default"
status: "in_progress"
priority: "high"
blockedBy:
  - "ab7b00bb-b362-44d9-917f-23fb0f4e85dd"
  - "0734e6b6-9223-4669-8df7-058cf683f10d"
startedAt: "2026-10-09T00:24:28.119Z"
acceptanceCriteria: []
description: "A dry run on this repository shows the template drafts from 2125f0cb read poorly: statements like \"The product provides <title>.\" or a copied work-shaped description; broken EARS (\"The system shall ensure that removes dead exports\"); process criteria (\"existing tests pass\", \"docs are updated\") turned into spec criteria; keyword test links that miss (a hench prompt capability linked to a web workspace test); and a specReviewed field on every draft, a name PR 30 retired.\n\nAdd a text drafting pass through @n-dx/llm-client, on by default, grounded only in the capability's own item, its applied history, the sourcevision code files and the linked tests passed in. It must not invent requirements. Keep the template draft as the no-model fallback, and fix it as well.\n\nAcceptance criteria:\n1. With the model mocked, a draft's statement is present tense and every criterion cites the source item id it came from (test).\n2. A drafted criterion that cites no source, or an id outside the capability's sources, is rejected; the template criterion is kept with a note (test).\n3. Process criteria (tests pass, docs updated, changeset added) are left out of the spec on both the model and template paths (test).\n4. Template EARS for a verb-led criterion is grammatical: \"removes dead exports\" becomes \"The system shall remove dead exports\" (test).\n5. Drafts carry no specReviewed field, and reviewedHash stays unset (test).\n6. Model answers are recorded in the plan, and an unchanged re-run reuses them (test).\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it (runs 699cd138 and the PR 17 store-transaction run failed only on that)."
lastModified: "2026-10-09T00:24:28.368Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
