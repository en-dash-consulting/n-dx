---
id: "0d5a1ff3-bcb9-42b9-8640-11d4ab3abb39"
type: "capability"
title: "Jira Work Tracking Integration"
slug: "jira-work-tracking-integration"
statement: "N-DX connects to a Jira project and exports or syncs PRD and backlog items to it as Jira issues, reporting which items succeeded or failed."
criteria: [{"id":"c1","text":"When a user with Jira access credentials configures the Jira integration, N-DX shall connect to the target Jira project."},{"id":"c2","text":"When the user exports or syncs PRD or backlog items to Jira, N-DX shall create or update the corresponding Jira issues."},{"id":"c3","text":"When a Jira sync action completes, N-DX shall display which items succeeded and which failed."},{"id":"c4","text":"N-DX shall track the Jira integration as a work-tracking target separate from the Notion integration."}]
priority: "medium"
---

Type: Story. Add Jira as a separate work-tracking integration target for N-DX.

User Story: As an N-DX user, I want to connect PRD/work items to Jira, so that teams using Jira can manage delivery from N-DX-generated requirements.

Acceptance Criteria:
- Given a user has Jira access credentials, when they configure the Jira integration, then N-DX can connect to the target Jira project.
- Given PRD or backlog items exist in N-DX, when the user exports or syncs them to Jira, then Jira issues are created or updated.
- Given a Jira sync action completes, when the result is displayed, then the user can see which items succeeded or failed.

Notes: Should be tracked separately from Notion rather than bundled into the MVP.
