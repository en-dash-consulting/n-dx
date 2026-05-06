---
id: "2037c955-24ba-4fc4-9d3f-6f17ddd70139"
level: "feature"
title: "Suppress Stale Project Setup Message When All Tool Directories Exist"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "The 'project setup is stale' notice is currently emitted in CLI contexts where it shouldn't appear, creating noise for users with fully initialized projects. Replace the trigger heuristic with a direct filesystem check for the three tool directories (.sourcevision, .rex, .hench) and only surface the message when one or more is missing."
---

# Suppress Stale Project Setup Message When All Tool Directories Exist

 [pending]

## Summary

The 'project setup is stale' notice is currently emitted in CLI contexts where it shouldn't appear, creating noise for users with fully initialized projects. Replace the trigger heuristic with a direct filesystem check for the three tool directories (.sourcevision, .rex, .hench) and only surface the message when one or more is missing.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add regression tests asserting stale-setup notice fires only on missing tool directories | task | pending | 1970-01-01 |
| Replace stale-setup trigger with direct existence check for .sourcevision, .rex, and .hench folders | task | completed | 2026-05-06 |

## Info

- **Status:** pending
- **Level:** feature
