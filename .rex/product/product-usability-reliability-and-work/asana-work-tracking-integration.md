---
id: "2800b15d-7a3f-42cb-ae77-b32e23eb3758"
type: "capability"
title: "Asana Work Tracking Integration"
slug: "asana-work-tracking-integration"
statement: "N-DX connects to an Asana workspace or project and syncs PRD and backlog items to it as Asana tasks, reporting which item updates succeeded and which failed."
criteria: [{"id":"c1","text":"When a user with Asana access configures the Asana integration, N-DX shall connect to the selected Asana workspace or project."},{"id":"c2","text":"When the user syncs PRD or backlog items to Asana, N-DX shall create or update a corresponding Asana task for each item."},{"id":"c3","text":"When an Asana sync action completes, N-DX shall show a result that identifies which item updates succeeded and which failed."}]
priority: "medium"
---

Type: Story. Add Asana as a separate work-tracking integration target for N-DX.

User Story: As an N-DX user, I want to connect PRD/work items to Asana, so that teams using Asana can manage generated work in their delivery workflow.

Acceptance Criteria:
- Given a user has Asana access, when they configure the Asana integration, then N-DX can connect to the selected workspace or project.
- Given PRD or backlog items exist in N-DX, when the user syncs them to Asana, then corresponding tasks are created or updated.
- Given an Asana sync action completes, when the result is shown, then the user can identify successful and failed item updates.

Notes: Should remain separate from Jira, GitHub Projects, and Notion integration work.
