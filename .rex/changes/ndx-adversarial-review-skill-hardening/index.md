---
id: "75bd9dee-f2ad-414f-9ca4-45d9f5f0c910"
type: "change"
title: "/ndx-adversarial-review skill hardening"
slug: "ndx-adversarial-review-skill-hardening"
intent: "Defects found by running `/ndx-adversarial-review` against its own introducing diff, on the day it was added.\n\nAll five are edits to the canonical skill body `packages/core/assistant-assets/skills/ndx-adversarial-review.md`, followed by regeneration of the `.claude/skills/` and `.agents/skills/` copies (`ndx init .`, or the generator in `packages/core/assistant-assets.js`). None of them require source changes to rex, hench, or core.\n\nThey are independent of each other — no ordering relationship, so no `blockedBy` edges are wired.\n\nThe review also surfaced findings deliberately NOT captured here:\n- **Not worth fixing:** the generator rewrote ten `ndx-*` SKILL.md files from CRLF to LF. Content diff is empty, `.gitattributes` pins those paths to `eol=lf`, and git normalizes on commit. Zero consequence.\n- **Out of scope (pre-existing):** `manifest.json` classifies `verify_criteria` as a write tool though `handleVerifyCriteria` only reads the store; nothing enforces that a new bundled skill gets a `SKILLS.md` row or a docs section; `/ndx-work` Step 7 instructs `date -Is`, which does not exist in PowerShell."
acceptanceCriteria:
  - "All five child tasks are completed"
  - "`packages/core/assistant-assets/skills/ndx-adversarial-review.md` contains no hardcoded `main` branch name and no instruction to guess PRD slugs"
  - "The generated `.claude/skills/` and `.agents/skills/` copies match the canonical source (tests/e2e/assistant-body-drift.test.js green)"
touches:
  - "ba9504c3-a0c7-4034-838c-2f5bf78ba904"
priority: "high"
tags:
  - "skills"
  - "assistant-assets"
  - "adversarial-review"
source: "ndx-adversarial-review"
---
