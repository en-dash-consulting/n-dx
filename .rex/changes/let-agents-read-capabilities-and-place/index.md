---
id: "6daf36b5-a47d-4974-b16a-964457ea40b5"
type: "change"
title: "Let agents read capabilities and place follow-ups; run task-less changes"
slug: "let-agents-read-capabilities-and-place"
intent: "Add get_capability and place_change to AGENT_REX_MCP_TOOLS (hench/src/process/agent-mcp-config.ts). apply_change stays operator-only. Hench runs a task-less change as a unit of work."
acceptanceCriteria:
  - "The allowlist includes the two tools and not apply_change"
  - "A task-less change completes through a hench run (test)"
amends: [{"target":"20d12416-3fa3-4bec-aa2d-0fb00a0fbf93","delta":"modified","summary":"Let agents read capabilities and place follow-ups; run task-less changes","base":"62c78c3983f252041bc969eac83a234aeb9518ab6d23737e8bf6fecdb90f5906"}]
priority: "medium"
tags:
  - "pr-19"
  - "lane-hench"
  - "hench"
source: "roadmap"
blockedBy:
  - "218ce010-b292-444e-9501-f2d8fc8335e2"
---
