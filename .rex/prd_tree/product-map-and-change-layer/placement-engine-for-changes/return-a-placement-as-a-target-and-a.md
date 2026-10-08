---
id: "2fa34877-3579-47b1-8c24-f1fd5298028d"
level: "task"
title: "Return a placement as a target and a relation, and place on constraints"
status: "pending"
priority: "high"
startedAt: "2026-10-08T04:35:10.790Z"
acceptanceCriteria: []
description: "Pre-freeze review finding 12 (2026-10-07, Ryan). Deadline: before PR 17, where the place_change MCP tool's result shape freezes. Runs after PR 30 is merged into this branch (it adds type on added amendments and fix on changes).\n\n- PlacementDecision.accepted (and each ranked candidate) becomes { target, relation }, where relation is touches or amends. A change with fix: true defaults to touches; a change whose title or intent asks for new behaviour defaults to amends (the rules decide; the text model and Jev pick the target, not the relation).\n- Constraints are placement candidates as well as capabilities (code-health findings touch the architecture constraint).\n- A placement may propose a new capability under an area (an added amendment with type), but that is never auto-accepted in any autoAccept mode; it always leaves needsPlacement set for a person.\n- Keep the Jev abstain option and the confidence checks from 381cbc77.\nTests for each point, with mocked model and Jev seams."
lastModified: "2026-10-08T04:48:56.834Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
