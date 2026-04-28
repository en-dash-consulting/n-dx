---
id: "66d94a74-d7f3-41b3-b0c4-abcbc0504710"
level: "task"
title: "Request deduplication infrastructure"
status: "completed"
source: "smart-add"
startedAt: "2026-02-26T18:14:34.818Z"
completedAt: "2026-02-26T18:14:34.818Z"
description: "Prevent duplicate in-flight requests by tracking active API calls and returning shared promises for identical requests"
---

## Subtask: Implement request deduplication for fetchPRDData calls

**ID:** `c8e90804-6b89-4dd8-a03f-c024bbf91631`
**Status:** completed
**Priority:** high

Add in-flight request tracking to prevent duplicate fetchPRDData API calls when WebSocket messages arrive during active polling requests

**Acceptance Criteria**

- fetchPRDData returns same promise when called while previous request is in-flight
- WebSocket message during 10s poll does not trigger duplicate API call
- Request tracking cleanup occurs when API call completes or fails

---

## Subtask: Implement request deduplication for fetchTaskUsage calls

**ID:** `33e0f73b-49f2-4b65-8a9d-a18f59635c94`
**Status:** completed
**Priority:** high

Add in-flight request tracking to prevent duplicate fetchTaskUsage API calls when WebSocket messages arrive during active polling requests

**Acceptance Criteria**

- fetchTaskUsage returns same promise when called while previous request is in-flight
- Multiple simultaneous usage requests resolve to single API call
- Request tracking handles both successful and error responses

---

## Subtask: Coordinate execution panel polling with WebSocket triggers

**ID:** `9a19a63a-c2e5-4b5b-81fe-794525d58e25`
**Status:** completed
**Priority:** medium

Implement coordination mechanism between execution-panel 3s polling and WebSocket message triggers to prevent simultaneous /api/rex/execute/status requests

**Acceptance Criteria**

- Execution panel polling respects in-flight requests from WebSocket handlers
- WebSocket handlers respect in-flight requests from polling loop
- Maximum one /api/rex/execute/status request active at any time

---

## Subtask: Add integration tests for request deduplication

**ID:** `eaa2fe40-140c-445d-8ee6-03b569e4e5e2`
**Status:** completed
**Priority:** medium

Create comprehensive test suite validating that request deduplication works correctly under various timing scenarios and prevents duplicate API calls

**Acceptance Criteria**

- Tests verify no duplicate API calls during overlapping fetch operations
- Tests cover WebSocket message arrival during active polling
- Tests validate request cleanup after completion and errors

---
