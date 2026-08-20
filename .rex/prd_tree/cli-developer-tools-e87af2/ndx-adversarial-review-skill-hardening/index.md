---
id: "75bd9dee-f2ad-414f-9ca4-45d9f5f0c910"
level: "feature"
title: "/ndx-adversarial-review skill hardening"
status: "pending"
priority: "high"
tags:
  - "skills"
  - "assistant-assets"
  - "adversarial-review"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "All five child tasks are completed"
  - "`packages/core/assistant-assets/skills/ndx-adversarial-review.md` contains no hardcoded `main` branch name and no instruction to guess PRD slugs"
  - "The generated `.claude/skills/` and `.agents/skills/` copies match the canonical source (tests/e2e/assistant-body-drift.test.js green)"
description: "Defects found by running `/ndx-adversarial-review` against its own introducing diff, on the day it was added.\n\nAll five are edits to the canonical skill body `packages/core/assistant-assets/skills/ndx-adversarial-review.md`, followed by regeneration of the `.claude/skills/` and `.agents/skills/` copies (`ndx init .`, or the generator in `packages/core/assistant-assets.js`). None of them require source changes to rex, hench, or core.\n\nThey are independent of each other — no ordering relationship, so no `blockedBy` edges are wired.\n\nThe review also surfaced findings deliberately NOT captured here:\n- **Not worth fixing:** the generator rewrote ten `ndx-*` SKILL.md files from CRLF to LF. Content diff is empty, `.gitattributes` pins those paths to `eol=lf`, and git normalizes on commit. Zero consequence.\n- **Out of scope (pre-existing):** `manifest.json` classifies `verify_criteria` as a write tool though `handleVerifyCriteria` only reads the store; nothing enforces that a new bundled skill gets a `SKILLS.md` row or a docs section; `/ndx-work` Step 7 instructs `date -Is`, which does not exist in PowerShell."
---

## Children

| Title | Status |
|-------|--------|
| [/ndx-adversarial-review hardcodes `main` as the branch-diff base](./ndx-adversarial-review-262f34.md) | completed |
| [/ndx-adversarial-review does not map findings onto add_item's level, priority, and acceptanceCriteria fields](./ndx-adversarial-review-does-not-13e505.md) | completed |
| [/ndx-adversarial-review records tokens without --startedAt, so the first record claims the whole session](./ndx-adversarial-review-records-08ceeb.md) | completed |
| [/ndx-adversarial-review Step 1 executes the test suite via verify_criteria's default runTests: true](./ndx-adversarial-review-step-1-9c9ea0.md) | pending |
| [/ndx-adversarial-review topic mode guesses slugs against get_item, which has no search](./ndx-adversarial-review-topic-581715.md) | pending |
