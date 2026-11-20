---
id: "23035796-603b-4124-87fb-e718e35dda79"
type: "task"
title: "Cut the lead sentence of .changeset/minified-by-content-share.md to 30 words or fewer"
slug: "cut-the-lead-sentence-of-changeset"
summary: "Shortens the opening sentence of one release note so it meets the release-notes rule."
description: "Read `.claude/skills/ndx-release-notes/SKILL.md`, then rewrite the lead sentence of `.changeset/minified-by-content-share.md` (34 words) to 30 or fewer: say what a user sees (hand-written JS/CSS with one long line is no longer treated as a minified bundle), and move the mechanism (the half-of-64-KiB share) into the next paragraph. Keep every fact; frontmatter unchanged. Run `npx vitest run tests/e2e/changeset-body-policy.test.js` from the repository root."
acceptanceCriteria:
  - "changeset-body-policy passes"
  - "No fact is lost from the changeset"
priority: "high"
run: {"tier":"light","skipTestGate":true}
tags:
  - "changeset"
---
