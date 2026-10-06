---
id: "1ba6a487-86db-4d43-a3b7-c88e402fd559"
level: "task"
title: "Move vendor-neutral sections from the Claude addendum into the shared guidance"
status: "completed"
priority: "medium"
tags:
  - "pr-06"
  - "lane-core-docs"
  - "core"
source: "roadmap"
startedAt: "2026-10-06T07:09:13.552Z"
completedAt: "2026-10-06T07:31:55.914Z"
endedAt: "2026-10-06T07:31:55.914Z"
resolutionType: "code-change"
resolutionDetail: "Moved the zone fragility governance, gateway modules, spawn-versus-gateway and concurrency contract sections (including the PRD write invariant) from claude-addendum.md into project-guidance.md, so AGENTS.md now carries them. The addendum keeps only the two pointers to Claude's per-directory CLAUDE.md files, under a new \"Claude-specific guidance files\" heading. Regenerated AGENTS.md and CLAUDE.md. instruction-alignment.test.js gained a CLAUDE_ONLY_HEADINGS allowlist that fails on any addendum heading not on it, plus explicit AGENTS.md assertions for the gateway rules and the PRD invariant; the stale \"AGENTS.md excludes these sections\" assertions in codex-integration.test.js and codex-artifact-validation.test.js were inverted."
acceptanceCriteria:
  - "AGENTS.md contains the gateway rules and the PRD write invariant"
  - "CLAUDE.md content is unchanged apart from ordering"
  - "A test fails if a vendor-neutral section exists only in the Claude addendum"
description: "Move the four sections into project-guidance.md, leave only genuinely Claude-specific content in claude-addendum.md, and regenerate AGENTS.md and CLAUDE.md with ndx init."
lastModified: "2026-10-06T07:31:56.371Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
