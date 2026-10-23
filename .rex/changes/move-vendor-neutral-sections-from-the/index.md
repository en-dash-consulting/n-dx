---
id: "1ba6a487-86db-4d43-a3b7-c88e402fd559"
type: "change"
title: "Move vendor-neutral sections from the Claude addendum into the shared guidance"
slug: "move-vendor-neutral-sections-from-the"
intent: "Move the four sections into project-guidance.md, leave only genuinely Claude-specific content in claude-addendum.md, and regenerate AGENTS.md and CLAUDE.md with ndx init."
acceptanceCriteria:
  - "AGENTS.md contains the gateway rules and the PRD write invariant"
  - "CLAUDE.md content is unchanged apart from ordering"
  - "A test fails if a vendor-neutral section exists only in the Claude addendum"
touches:
  - "72d599a7-a398-405e-850d-9ae79659b15e"
priority: "medium"
tags:
  - "pr-06"
  - "lane-core-docs"
  - "core"
source: "roadmap"
---
