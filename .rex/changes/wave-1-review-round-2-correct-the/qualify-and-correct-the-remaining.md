---
id: "a8a4ea8c-27a9-445a-9374-f3f3ba7aeb37"
type: "task"
title: "Qualify and correct the remaining Codex broker changesets"
slug: "qualify-and-correct-the-remaining"
description: "PR #1008 review comments https://github.com/en-dash-consulting/n-dx/pull/1008#discussion_r4558509490 and https://github.com/en-dash-consulting/n-dx/pull/1008#discussion_r4558509495. tidy-sidecar-broker-approval.md, sidecar-configured-cli-path.md and codex-mcp-tool-call-items.md lack the experimental qualifier; the first two are written as instructions and mention test work. sidecar-checkpoint-completion.md says the next turn starts cold only after configuration is repaired and that only successful checkpoint usage is included, but the catch sets refresh whatever the cause and a failed checkpoint that spawned is billed too. Follow .claude/skills/ndx-release-notes/SKILL.md."
acceptanceCriteria:
  - "tidy-sidecar-broker-approval.md, sidecar-configured-cli-path.md and codex-mcp-tool-call-items.md each lead with '(experimental, off by default; enable with `web.sidecar`)'."
  - "Those leads describe the user-visible effect, not instructions, and carry no test work outside a Test-only: line."
  - "sidecar-checkpoint-completion.md states that any checkpoint usage spent is recorded once and the next turn starts with fresh context."
priority: "high"
source: "ndx-capture"
---
