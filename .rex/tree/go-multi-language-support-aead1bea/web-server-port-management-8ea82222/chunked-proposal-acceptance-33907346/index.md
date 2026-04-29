---
id: "33907346-1639-4f74-9e6f-b3ba456cc911"
level: "task"
title: "Chunked proposal acceptance"
status: "completed"
source: "smart-add"
startedAt: "2026-02-06T04:00:51.629Z"
completedAt: "2026-02-06T04:43:01.162Z"
acceptanceCriteria: []
description: "Allow users to accept proposals in smaller or larger batches instead of all-or-nothing"
---

## Subtask: Add chunk size parameter to rex analyze command

**ID:** `97487bb1-d42b-4296-b85a-223870f54268`
**Status:** completed
**Priority:** medium

Allow users to specify how many proposals to present at once using --chunk-size flag

**Acceptance Criteria**

- Supports --chunk-size parameter with default of current behavior
- Validates chunk size is positive integer
- Handles edge cases when chunk size exceeds total proposals

---

## Subtask: Implement interactive proposal chunking workflow

**ID:** `ae83f04a-1238-422a-a725-e7edaaaf7654`
**Status:** completed
**Priority:** high

Present proposals in user-specified chunks with options to accept current chunk, request more, or request fewer

**Acceptance Criteria**

- Shows current chunk with clear pagination (e.g., 'Proposals 1-5 of 23')
- Provides options: Accept these, Show more, Show fewer, Accept all, Reject all
- Maintains state between chunk selections
- Allows navigation back to previous chunks

---

## Subtask: Add dynamic chunk resizing during proposal review

**ID:** `a59d064f-b71a-452a-89e6-251965e638ee`
**Status:** completed
**Priority:** medium

Allow users to adjust chunk size on-the-fly while reviewing proposals

**Acceptance Criteria**

- Supports 'more' command to increase current chunk size
- Supports 'fewer' command to decrease current chunk size
- Preserves current position when resizing chunks
- Updates pagination display after resize

---

## Subtask: Implement proposal batch acceptance tracking

**ID:** `efbf3759-abb6-406a-b96a-aa094309d3fb`
**Status:** completed
**Priority:** low

Track which proposals were accepted in which batches for better user feedback

**Acceptance Criteria**

- Records batch acceptance decisions in workflow state
- Shows summary of accepted vs rejected proposals
- Provides clear feedback about what was added to PRD

---

## Subtask: Add granularity adjustment to interactive add workflow

**ID:** `d0d952ee-ed3b-4e20-9d55-c77fca4d60ce`
**Status:** completed
**Priority:** medium

Extend the rex add command's interactive mode to allow users to request tasks be broken down into smaller subtasks or consolidated into larger ones during the approval flow

**Acceptance Criteria**

- Users can request task breakdown during add command approval
- Users can request task consolidation during add command approval
- Granularity adjustments preserve original intent and acceptance criteria
- Interactive prompts clearly explain granularity options

---

## Subtask: Implement task granularity assessment

**ID:** `4f44a47e-ff74-4016-b44b-ee45b51479af`
**Status:** completed
**Priority:** medium

Add LLM-powered analysis to evaluate whether proposed tasks are appropriately sized and suggest granularity improvements

**Acceptance Criteria**

- Analyzes task scope and complexity automatically
- Suggests when tasks should be broken down
- Suggests when tasks should be consolidated
- Provides reasoning for granularity recommendations

---

## Subtask: Add granularity controls to batch acceptance

**ID:** `39263ff2-8324-43a7-a5ef-23cdaaedef0a`
**Status:** completed
**Priority:** low

Integrate granularity adjustment options into the existing chunked proposal workflow so users can refine task sizing across proposal batches

**Acceptance Criteria**

- Granularity options available in chunked proposal review
- Batch operations preserve granularity adjustments
- Users can apply granularity changes to multiple proposals at once
- Granularity tracking persists across proposal chunks

---
