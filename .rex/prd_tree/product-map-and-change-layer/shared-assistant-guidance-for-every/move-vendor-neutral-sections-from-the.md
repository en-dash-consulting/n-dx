---
id: "1ba6a487-86db-4d43-a3b7-c88e402fd559"
level: "task"
title: "Move vendor-neutral sections from the Claude addendum into the shared guidance"
status: "pending"
priority: "medium"
tags:
  - "pr-06"
  - "lane-core-docs"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "AGENTS.md contains the gateway rules and the PRD write invariant"
  - "CLAUDE.md content is unchanged apart from ordering"
  - "A test fails if a vendor-neutral section exists only in the Claude addendum"
description: "Move the four sections into project-guidance.md, leave only genuinely Claude-specific content in claude-addendum.md, and regenerate AGENTS.md and CLAUDE.md with ndx init."
lastModified: "2026-10-06T04:16:50.534Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
