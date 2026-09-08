---
id: "731dadee-9474-4f8d-8342-0040a57da8c4"
level: "feature"
title: "Shipped Assistant-Asset Prompt Parity & Portability"
status: "pending"
priority: "medium"
tags:
  - "prompts"
  - "skills"
  - "core"
  - "portability"
blockedBy:
  - "4aa01e0c-31d5-4db0-9386-214b01da32dd"
source: "ndx-capture"
acceptanceCriteria:
  - "Each shipped skill matches its .claude/skills/ counterpart in wording and intent, with any remaining difference documented as deliberate rather than left as unexplained drift."
  - "An automated check fails when a project skill and its shipped copy diverge outside the documented allowances."
  - "No shipped skill assumes a shell, package manager, test runner, or directory layout; commands are discovered from the target repo at run time."
  - "project-guidance.md, claude-addendum.md, and SKILLS.md carry no instruction that contradicts the rewritten skills, preserving the design invariant that both AGENTS.md and CLAUDE.md derive from the same shared source."
  - "Re-running ndx init regenerates the instruction files cleanly and the generated output reflects the tightened wording."
description: "Propagate the tightened wording into the copies that ship to user repositories via ndx init: the 10 skills under packages/core/assistant-assets/skills/, plus project-guidance.md, claude-addendum.md, and SKILLS.md. These land in codebases with unknown stacks, so they carry a stricter constraint than the project-local skills — nothing may assume this repo's shell, package manager, or layout. Line counts already differ slightly from the .claude/skills/ originals (ndx-capture 32 vs 37, ndx-adversarial-review 102 vs 107); the differences need to be either justified or eliminated, not left ambiguous."
lastModified: "2026-09-08T13:08:29.036Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
