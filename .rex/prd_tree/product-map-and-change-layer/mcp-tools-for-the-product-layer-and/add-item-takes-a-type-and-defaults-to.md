---
id: "fdddee24-1661-4f65-adc7-3946452bc8f8"
level: "task"
title: "add_item takes a type and defaults to a change in the Inbox"
status: "pending"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "level-only calls are refused with a message naming type (test)"
  - "A call with no type creates an Inbox change (test)"
description: "add_item accepts type plus amends and touches. A call with only level is refused with a message naming type. A call with neither creates a change in the Inbox with needsPlacement."
lastModified: "2026-10-06T04:18:01.296Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
