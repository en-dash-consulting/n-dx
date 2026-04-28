---
id: "0cf188b5-61e7-4aab-8ba5-d101a5e0a582"
level: "task"
title: "OOM Crash Investigation and Root Cause Analysis"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T19:29:13.108Z"
completedAt: "2026-02-24T19:29:13.108Z"
description: "Investigate and diagnose the recurring out-of-memory crashes that cause 'aw snap error code 5' in the web UI"
---

## Subtask: Profile memory usage patterns during web UI load and refresh cycles

**ID:** `255e92f3-db5f-4151-ae4c-6feb67c32541`
**Status:** completed
**Priority:** critical

Use browser dev tools and memory profiling to identify memory allocation patterns, leaks, and peak usage during initial load and subsequent refresh operations

**Acceptance Criteria**

- Memory usage baseline established for normal UI operations
- Memory spikes during refresh operations identified and quantified
- Specific components or operations causing excessive memory allocation documented

---

## Subtask: Analyze refresh task orchestration for memory-intensive operations

**ID:** `7bdfa843-b611-4d44-a831-4e735ec5dfdb`
**Status:** completed
**Priority:** critical

Examine the ndx refresh command and related web UI refresh behaviors to identify operations that may be loading excessive data into memory

**Acceptance Criteria**

- All refresh tasks and their memory footprint catalogued
- Data loading patterns in dashboard refresh operations analyzed
- Refresh orchestration flow documented with memory impact assessment

---

## Subtask: Investigate browser error code 5 triggers and recovery scenarios

**ID:** `0b87a119-c6a2-498a-ad5f-050e70f3b664`
**Status:** completed
**Priority:** high

Research Chrome/browser error code 5 specifics and analyze crash dump data to understand the exact failure conditions and memory thresholds

**Acceptance Criteria**

- Error code 5 trigger conditions documented
- Memory thresholds that cause crashes identified
- Browser-specific behavior differences catalogued

---
