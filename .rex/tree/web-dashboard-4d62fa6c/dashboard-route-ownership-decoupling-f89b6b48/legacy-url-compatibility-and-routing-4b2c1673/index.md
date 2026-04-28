---
id: "4b2c1673-3a09-49b1-93c4-c31f51c9c938"
level: "task"
title: "Legacy URL Compatibility and Routing Regression Coverage"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T21:30:18.392Z"
completedAt: "2026-02-22T21:30:18.392Z"
description: "Keep old Rex Token Usage links functional while enforcing the new global canonical route through deterministic redirects and tests."
---

## Subtask: Implement canonical redirect rules from legacy Rex token URLs

**ID:** `15ac84f7-cd8c-4ef7-aa03-1389ddd7e672`
**Status:** completed
**Priority:** high

Add or refine redirect normalization so old Rex-prefixed token usage URLs resolve to the global token usage route, preserving user bookmarks and shared links during the ownership migration.

**Acceptance Criteria**

- Legacy Rex token usage URL variants redirect to the canonical global token usage URL
- Redirect logic avoids loops and always terminates at a single canonical destination
- Direct navigation to the canonical token usage URL renders without intermediate error states

---

## Subtask: Add regression tests for direct global reachability and legacy redirects

**ID:** `e37196bb-0561-49f2-bf5f-4217316c8ccd`
**Status:** completed
**Priority:** critical

Create automated routing tests to prove Token Usage is directly reachable as a global destination and that legacy Rex links remain compatible through redirects.

**Acceptance Criteria**

- Test covers direct navigation to canonical `token-usage` route and validates successful render
- Test covers at least one legacy Rex token URL and asserts redirect target equals canonical global route
- Test suite fails if token-usage is reintroduced under Rex scope mappings

---
