---
id: "a53b2572-87a8-4eb2-804a-2b9ae668b930"
type: "capability"
title: "PRD Management Enhancement"
slug: "prd-management-enhancement"
statement: "Rex lets users manipulate, navigate, validate and clean up the PRD tree, and exposes these operations through the Rex web dashboard."
criteria: [{"id":"c1","text":"Rex shall provide operations that manipulate the PRD tree."},{"id":"c2","text":"Rex shall provide navigation of the PRD tree."},{"id":"c3","text":"The Rex web dashboard shall expose the PRD management operations."},{"id":"c4","text":"Rex shall validate the PRD against its schema."},{"id":"c5","text":"When a PRD uses an earlier schema version, Rex shall migrate it to the current schema."},{"id":"c6","text":"Rex shall provide cleanup tools that restore PRD integrity."},{"id":"c7","text":"The Rex store shall persist configuration and workflow state."},{"id":"c8","text":"If a task status transition is invalid, Rex shall reject it with an error message."},{"id":"c9","text":"If a task's blockedBy dependencies are invalid, Rex shall reject them with an error message."}]
source: "llm"
---
