---
id: "51749fa5-9948-4ca3-afa5-b23cbbc7573b"
type: "change"
title: "Implement terminal auto-commit step in each file-modifying external skill"
slug: "implement-terminal-auto-commit-step-in"
intent: "For every skill identified as file-modifying and not already committing, add a terminal step that stages all modified files, generates a concise commit message scoped to the skill's action (e.g., 'Apply simplify cleanup pass' or 'Update Claude Code settings via update-config'), and commits before the skill signals completion. The step must be a no-op when the working tree is clean after the skill's work. Hench run-loop skills and read-only skills must remain entirely unchanged."
acceptanceCriteria:
  - "Each targeted file-modifying external skill stages and commits changes as its final step"
  - "Commit message includes the skill name and a one-line summary of what changed"
  - "Skill exits cleanly without attempting a commit when the working tree is clean"
  - "Hench agent run-loop skills are not touched and do not gain or lose commit behavior"
  - "Read-only skills (triage, code-review without --fix, etc.) are not modified"
amends: [{"target":"efac37e0-dc05-4140-b0e1-dfb3e24b6f7e","delta":"modified","summary":"Implement terminal auto-commit step in each file-modifying external skill","base":"f6e4a200dceef96d240ba55e5dfc081e6344122bde86a449176f8fdf98f4e246"}]
priority: "critical"
tags:
  - "skills"
  - "claude-code"
  - "commit"
  - "automation"
source: "smart-add"
---
