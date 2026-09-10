---
id: "731dadee-9474-4f8d-8342-0040a57da8c4"
level: "feature"
title: "Shipped Assistant-Asset Prompt Parity & Portability"
status: "completed"
priority: "medium"
tags:
  - "prompts"
  - "skills"
  - "core"
  - "portability"
blockedBy:
  - "4aa01e0c-31d5-4db0-9386-214b01da32dd"
source: "ndx-capture"
startedAt: "2026-09-08T18:28:06.146Z"
completedAt: "2026-09-08T18:36:13.450Z"
endedAt: "2026-09-08T18:36:13.450Z"
resolutionType: "code-change"
resolutionDetail: "SKILLS.md prescribed a heredoc commit step that skill-portability.test.js forbids, so following the authoring reference produced a skill that failed CI — the guard only read skill bodies, never the reference. Rewrote it to the file-based `git commit -F` form and extended the guard to cover SKILLS.md. Also closed a parity gap: assistant-body-drift compares committed vs generated (always agreeing, even when the generator is wrong), so skill-sync now asserts the generated body is byte-identical to the canonical source with frontmatter the only permitted difference. Criteria 1, 2, 3 and 5 were already satisfied — the shipped assets are the source of truth, not copies, and the cited line-count \"drift\" is the 6-line frontmatter block."
acceptanceCriteria:
  - "Each shipped skill matches its .claude/skills/ counterpart in wording and intent, with any remaining difference documented as deliberate rather than left as unexplained drift."
  - "An automated check fails when a project skill and its shipped copy diverge outside the documented allowances."
  - "No shipped skill assumes a shell, package manager, test runner, or directory layout; commands are discovered from the target repo at run time."
  - "project-guidance.md, claude-addendum.md, and SKILLS.md carry no instruction that contradicts the rewritten skills, preserving the design invariant that both AGENTS.md and CLAUDE.md derive from the same shared source."
  - "Re-running ndx init regenerates the instruction files cleanly and the generated output reflects the tightened wording."
description: "Propagate the tightened wording into the copies that ship to user repositories via ndx init: the 10 skills under packages/core/assistant-assets/skills/, plus project-guidance.md, claude-addendum.md, and SKILLS.md. These land in codebases with unknown stacks, so they carry a stricter constraint than the project-local skills — nothing may assume this repo's shell, package manager, or layout. Line counts already differ slightly from the .claude/skills/ originals (ndx-capture 32 vs 37, ndx-adversarial-review 102 vs 107); the differences need to be either justified or eliminated, not left ambiguous."
lastModified: "2026-09-08T18:36:13.478Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
