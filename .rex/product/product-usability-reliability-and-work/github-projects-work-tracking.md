---
id: "84aa58d1-f940-48a9-b2bc-11976dd28f48"
type: "capability"
title: "GitHub Projects Work Tracking Integration"
slug: "github-projects-work-tracking"
statement: "n-dx connects PRD items to a GitHub Projects board and creates or updates the matching project items when it syncs."
priority: "medium"
---

Type: Story. Add GitHub Projects as a separate work-tracking integration target for N-DX.

User Story: As an N-DX user, I want to connect PRD/work items to GitHub Projects, so that development teams can manage generated work close to their codebase.

Acceptance Criteria:
- Given a user has GitHub access, when they configure the GitHub Projects integration, then N-DX can connect to the selected project.
- Given PRD or backlog items exist in N-DX, when the user syncs them to GitHub Projects, then corresponding project items are created or updated.
- Given sync results are available, when the user reviews them, then item-level success and failure information is visible.

Notes: Should be treated as a separate integration story.

## History

- 2026-10-23 editorial: statement edited
