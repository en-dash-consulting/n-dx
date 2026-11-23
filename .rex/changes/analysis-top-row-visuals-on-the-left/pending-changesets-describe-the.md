---
id: "8de74918-c02e-41cb-9f92-0e98ae8d001e"
type: "task"
title: "Pending changesets describe the replaced three-tile Analysis UI"
slug: "pending-changesets-describe-the"
summary: "Two release notes waiting to ship describe an Analysis layout that this work replaces, so the next changelog would contradict itself. This rewrites them to the final layout."
description: "Verdict: should-fix (severity low), from the adversarial review of feat/analysis-two-tile-top-row.\n\n.changeset/analyze-health-what-to-do.md and .changeset/analyze-recommendations-to-prd.md (from feat/standalone-executable, not on main, so in the same unreleased batch) describe three tiles, 'What to do' lists and 'opened Codebase health and Infrastructure & architecture tiles'. The next CHANGELOG would describe a top row and its replacement together.\n\nFix: reword both to the final state, or fold them into .changeset/analysis-two-tile-top-row.md. Read .claude/skills/ndx-release-notes/SKILL.md first."
acceptanceCriteria:
  - "No pending changeset describes the three-tile Analysis top row or its What to do lists"
  - "The changesets describe the two-tile top row and Recommended fixes, and tests/e2e/changeset-body-policy.test.js passes"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
