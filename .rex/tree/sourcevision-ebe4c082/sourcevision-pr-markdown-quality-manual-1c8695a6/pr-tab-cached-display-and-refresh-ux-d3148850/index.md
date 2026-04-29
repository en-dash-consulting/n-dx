---
id: "d3148850-209f-4665-bb85-4e51bda91055"
level: "task"
title: "PR Tab Cached Display and Refresh UX"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T07:42:35.390Z"
completedAt: "2026-02-21T07:42:35.390Z"
acceptanceCriteria: []
description: "Update the SourceVision PR tab to show cached output and clear state messaging around freshness and failures."
---

## Subtask: Render cached PR markdown content with last-refreshed timestamp in PR tab

**ID:** `04081b33-107b-4e17-a7b7-a61edc6bd1e0`
**Status:** completed
**Priority:** high

Ensure the tab shows the most recent generated artifact and metadata so users can trust what they are viewing.

**Acceptance Criteria**

- PR tab loads cached markdown without triggering generation
- UI displays a visible Last Refreshed timestamp from cache metadata
- Timestamp formatting is consistent across reloads and navigation

---

## Subtask: Implement explicit Refresh button in PR tab wired to manual regeneration endpoint

**ID:** `12939351-0829-43b9-9ff1-587350ba661b`
**Status:** completed
**Priority:** high

Allow users to regenerate output from within the tab without relying on automatic background updates.

**Acceptance Criteria**

- Refresh button invokes regeneration endpoint only on user click
- UI shows in-progress state while refresh is running and disables duplicate clicks
- On success, markdown content and last-refreshed timestamp update immediately

---

## Subtask: Add stale, not-yet-generated, and refresh-error state views in PR tab

**ID:** `013535a3-bd94-4d82-af86-d1aec17901b9`
**Status:** completed
**Priority:** high

Provide clear remediation guidance when content is outdated, missing, or generation fails.

**Acceptance Criteria**

- Not-yet-generated state appears when no cached artifact exists and includes clear next action
- Stale state appears when cache is older than defined threshold and prompts manual refresh
- Refresh-error state shows error message plus option to retry without losing last successful output

---
