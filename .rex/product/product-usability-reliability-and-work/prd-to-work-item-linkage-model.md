---
id: "305318f8-eaa9-44bb-938b-4b05a86126eb"
type: "capability"
title: "PRD-to-Work-Item Linkage Model"
slug: "prd-to-work-item-linkage-model"
statement: "N-DX links PRD requirements to downstream work-tracking items so that requirements stay traceable through delivery."
criteria: [{"id":"c1","text":"When a downstream work item is created for an existing PRD requirement, N-DX shall store the relationship between the PRD item and the work item."},{"id":"c2","text":"When a PRD is viewed, N-DX shall show the work items linked to each PRD requirement."},{"id":"c3","text":"When a linked work item changes status in an integrated system and sync status is available, N-DX shall show the latest known state of that item on the PRD linkage."}]
priority: "high"
---

Type: Story. Define and support linkage between N-DX PRD requirements and downstream work-tracking items.

User Story: As an N-DX user, I want PRD requirements linked to downstream work items, so that requirements remain traceable through delivery.

Acceptance Criteria:
- Given a PRD requirement exists, when a downstream work item is created, then the relationship between the PRD item and work item is stored.
- Given a work item is linked to a PRD requirement, when the PRD is viewed, then the linked item is visible.
- Given a linked item changes status in an integrated system, when sync status is available, then the PRD linkage reflects the latest known state.

Notes: Provides the common model needed for Notion, Jira, GitHub Projects, and Asana integrations.
