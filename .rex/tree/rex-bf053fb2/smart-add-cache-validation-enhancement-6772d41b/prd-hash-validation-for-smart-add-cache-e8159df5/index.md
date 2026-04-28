---
id: "e8159df5-c695-4c99-b0c0-852f340bf809"
level: "task"
title: "PRD Hash Validation for Smart Add Cache"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T06:05:30.268Z"
completedAt: "2026-03-06T06:05:30.268Z"
description: "Add PRD hash validation to smart-add pending proposal cache to prevent applying stale proposals when PRD changes between generation and acceptance"
---

## Subtask: Add staleness detection for cached proposals

**ID:** `5bdab225-50f0-4d3b-b58f-5e6b884e1ac6`
**Status:** completed
**Priority:** medium

Implement validation logic in tryAcceptCachedProposals to detect when PRD has changed since cached proposals were generated and handle stale cache appropriately

**Acceptance Criteria**

- Current PRD hash computed and compared with cached prdHash in tryAcceptCachedProposals
- Warning message displayed when PRD changes detected: 'PRD has changed since proposals were generated'
- Stale cache automatically cleared when hash mismatch found
- Backwards compatibility maintained for cache entries without hash
- Function returns false when stale cache detected to trigger regeneration

---

## Subtask: Implement PRD hash validation in smart-add cache structure

**ID:** `d96ec242-803d-40ff-a008-609baa3d3366`
**Status:** completed
**Priority:** critical

Update pending proposal cache to include PRD hash metadata and implement hash calculation function for PRD change detection

**Acceptance Criteria**

- hashPRD function implemented using SHA256 of canonical JSON
- savePending function updated to accept and store prdHash parameter
- loadPending function return type updated to include optional prdHash field
- Required crypto and canonical JSON imports added

---

## Subtask: Update cache save operations with hash metadata

**ID:** `f254899a-6ef9-4ff8-8380-59752d29b5aa`
**Status:** completed
**Priority:** high

Modify all savePending call sites to compute and pass PRD hash, ensuring cache entries include hash metadata for validation

**Acceptance Criteria**

- Both savePending call sites (around lines 1140 and 1326) updated to compute and pass PRD hash
- PRD items accessible at call sites for hash computation
- Cache structure consistently includes prdHash field across all save operations
- Hash computation uses current PRD state at time of caching

---
