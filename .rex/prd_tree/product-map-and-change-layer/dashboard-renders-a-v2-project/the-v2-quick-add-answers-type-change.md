---
id: "bbbb68d6-5efa-4bd1-b4cf-77e5a437fa3f"
level: "task"
title: "The v2 Quick Add answers type change and refuses any other type"
status: "pending"
priority: "medium"
tags:
  - "pr-36"
  - "review-2026-10-13"
  - "lane-web"
source: "review-2026-10-13"
acceptanceCriteria:
  - "POST /api/rex/items on a v2 project answers type: \"change\" (route test that fails on the current head)"
  - "A v2 POST with a type other than absent or change (capability, task, subtask) with no parent is refused with a reason and writes nothing (route test)"
  - "The changeset's /api line describes the new response shape; no note promises roadmap PR 21 lifts the parentId refusal; v1 add is unchanged"
description: "Holistic review of the combined v2 stack, 2026-10-13 (web area W2, should-fix, CONFIRMED). This task is Ryan's part (#693): the response shape and the type check. Hal's part (#728's toast and Add form) is separate.\n- **Where.**\n  - #728 @ 6f021b924:\n    - `viewer/hooks/use-prd-actions.ts:230,253,278` now toast `result.type`.\n    - `viewer/components/prd-tree/add-item-form.ts:40-44` offers only epic/feature/task/subtask, and its comment says \"The route behind it writes a v1 store\".\n  - #693 @ 9fee06ad3:\n    - `server/routes-rex/items.ts:478` makes the v2 Quick Add answer `{ ok, id, level: \"change\", title, needsPlacement }`, with no `type`.\n    - The v2 branch above it (`:342-358`) ignores the request's `type`.\n- **Failure.**\n  - On a v2 project the command-bar Add shows a v1 type picker with \"Epic\" selected.\n  - Submitting creates an Inbox change, and the toast reads \"Created undefined: <title>\". At #693 alone it read \"Created change: …\", because it used `result.level`.\n  - Through the API, `POST {\"title\":\"x\",\"type\":\"capability\"}` (or `\"task\"`, or `\"subtask\"`) with no parent creates an Inbox change instead of refusing. #728 added that refusal on v1, but the v2 branch runs first and never reaches it.\n  - #728's premise that the store behind the route is still v1 was already false on its own base: a36056049 holds #693's v2 branch.\n- **Fix.**\n  - In the v2 branch, answer `type: \"change\"`. Keep `level` only if the #693 changeset line stays; otherwise drop it and amend that line.\n  - Accept `type` absent or `change`, and refuse any other type with a reason.\n  - Have the form offer `change` (and `task` under a change, once W3 lands) when the PRD is v2. The viewer can read the layout from `/api/rex/product`'s `layout` or from the PRD payload.\n- **Owners.** Hal (#728) for the toast and the form; Ryan (#693) for the response shape and the type check.\n- **Status: CONFIRMED** by reading both sides on the merged tree. The paths are deterministic.\n\nAlso from the hygiene review (H2): #693's changeset says the v2 Quick Add response carries level: \"change\", which is not a v1 level; correct the changeset line to the new shape. And the v2 parentId refusal or its changeset note must not promise that roadmap PR 21 lifts the refusal, since #728 (which is PR 21's web half) does not; say what to do instead only."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T17:55:11.811Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
