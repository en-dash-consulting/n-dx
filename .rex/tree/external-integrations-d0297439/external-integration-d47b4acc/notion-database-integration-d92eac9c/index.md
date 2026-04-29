---
id: "d92eac9c-85cc-4f70-998e-51b353990939"
level: "task"
title: "Notion Database Integration"
status: "completed"
source: "llm"
startedAt: "2026-02-09T15:47:21.681Z"
completedAt: "2026-02-09T15:47:21.681Z"
acceptanceCriteria: []
description: "Complete mapping between PRD structure and Notion databases"
---

## Subtask: Define Notion level configuration

**ID:** `b23b4a4a-12e0-4060-b5aa-dfc270ff0453`
**Status:** completed
**Priority:** high

Configure proper hierarchy mapping for all PRD levels in Notion. NOTION_LEVEL_CONFIG defines parentLevel and statusMap for all four levels (epic, feature, task, subtask). Each statusMap covers all five PRD statuses (pending, in_progress, completed, deferred, blocked) mapped to their Notion equivalents.

**Acceptance Criteria**

- defines config for all four PRD levels
- epics are top-level (no parent level)
- maps status values for all levels
- maps all status values correctly

---

## Subtask: Map PRD items to Notion pages

**ID:** `afaa20c0-b9db-440e-9374-773e37651b4f`
**Status:** completed
**Priority:** high

Convert PRD items to Notion page properties with proper field mapping

**Acceptance Criteria**

- maps a basic task to Notion page properties
- maps tags to multi-select
- maps description to both property and body content blocks
- maps source to rich_text property
- maps blockedBy to comma-separated rich_text property
- maps all PRD fields to Notion properties
- maps acceptance criteria to a checklist in body
- maps epic level correctly
- omits priority when not set
- omits tags when not set
- omits description property when not set
- omits source when not set
- omits blockedBy when not set
- omits blockedBy when empty array

---

## Subtask: Map Notion pages to PRD items

**ID:** `344fb42e-0407-41ed-a8cb-9ffd1c82fee7`
**Status:** completed
**Priority:** high

Convert Notion pages back to PRD item structure

**Acceptance Criteria**

- maps a Notion page to a PRDItem
- uses Notion page ID as item ID when no PRD ID present
- maps all Notion statuses back to PRD statuses
- defaults to pending for unknown Notion status
- extracts description from Description property
- extracts description from body blocks when no Description property
- prefers Description property over body blocks
- extracts description from multiple paragraphs before heading
- extracts acceptance criteria from body blocks
- ignores to_do blocks outside of Acceptance Criteria section
- extracts source from Source property
- extracts blockedBy from Blocked By property
- handles single blockedBy value
- handles text.content format for Description property
- omits priority and tags when not present in Notion
- omits source when not present in Notion
- omits blockedBy when not present in Notion
- resolves known status names by exact match
- resolves unknown status name via group fallback
- falls back to pending for completely unknown status without group
- falls back to pending for unknown status with unknown group
- resolves custom status options via group map
- integrates with mapNotionToItem for custom status options
- forwards statusGroupMap when reconstructing document tree
- maps priority and tags from Notion

---

## Subtask: Handle document-level mapping

**ID:** `6bde7f91-149b-4487-b734-78f032ad061e`
**Status:** completed
**Priority:** high

Map entire PRD documents to and from Notion database structures

**Acceptance Criteria**

- flattens a PRD tree into Notion page descriptors with parent refs
- preserves full depth: epic > feature > task > subtask
- reconstructs PRD tree from flat Notion pages
- reconstructs a tree from flat Notion pages
- places orphaned items at root level

---

## Subtask: Define Notion database schema

**ID:** `449ebc63-c229-4e07-a797-e0f7c3fbe4a9`
**Status:** completed
**Priority:** medium

Specify complete database schema with proper field types and options

**Acceptance Criteria**

- defines options for all five PRD statuses
- defines options for all four PRD priorities
- includes all status options
- includes all priority options
- assigns each status to a Notion status group
- provides color for each option
- maintains the canonical Notion status names
- uses title-cased names for Notion display
- declares Status as native status type (not select)
- declares Priority as select type
- declares Name as title type
- includes status groups with correct assignments

---

## Subtask: Validate database schema

**ID:** `173a90ca-cfc3-4ed5-bfc2-a28e3a95341f`
**Status:** completed
**Priority:** medium

Ensure Notion databases have required properties with correct types

**Acceptance Criteria**

- reports missing required properties
- reports wrong property type for Status
- allows missing optional properties

---

## Subtask: Ensure round-trip fidelity

**ID:** `81c39b5e-f127-416a-9bec-674eaed34f01`
**Status:** completed
**Priority:** high

Verify data integrity through complete mapping cycles

**Acceptance Criteria**

- round-trips all fields through mapItemToNotion and mapNotionToItem

---

## Subtask: Improve Notion page management

**ID:** `714d8f4d-f3b7-4bcb-b9dc-cb542c286006`
**Status:** completed
**Priority:** high

Enhance Notion page creation, updates, and management

**Acceptance Criteria**

- creates pages for new items
- updates existing pages
- creates a new page in Notion
- creates page under parent when parentId given
- updates an existing item
- removes an existing item
- archives the Notion page

---
