---
id: "38db1905-bcc0-463e-a576-057b7ef0914a"
type: "capability"
title: "Notion Work Tracking Integration MVP"
slug: "notion-work-tracking-integration-mvp"
statement: "N-DX connects PRD and work items to a selected Notion database, pushes them to Notion as created or updated records, and reports whether each sync succeeded or failed."
criteria: [{"id":"c1","text":"When a user who has Notion integration credentials configures the integration, N-DX shall connect to the selected Notion database."},{"id":"c2","text":"When the user pushes PRD or work items to Notion, N-DX shall create or update the corresponding Notion records."},{"id":"c3","text":"When a Notion sync action completes, N-DX shall report to the user whether the sync succeeded or failed."}]
priority: "high"
---

Type: Story. Create an MVP integration that allows N-DX PRD or work items to connect with Notion as the first supported work-tracking target.

User Story: As an N-DX user, I want to connect PRD/work items to Notion, so that planning artifacts can be tracked in a working project system.

Acceptance Criteria:
- Given a user has Notion integration credentials, when they configure the integration, then N-DX can connect to the selected Notion database.
- Given PRD or work item data exists in N-DX, when the user pushes items to Notion, then corresponding Notion records are created or updated.
- Given a Notion sync action completes, when the user reviews the result, then success or failure is clearly reported.

Notes: Notion is the first MVP target for proving work-tracking integration.
