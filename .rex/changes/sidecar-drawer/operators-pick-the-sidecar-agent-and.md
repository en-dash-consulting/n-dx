---
id: "4f37d5e4-3cb0-4947-a9df-5c50fc322829"
type: "task"
title: "Operators pick the Sidecar agent and expand tool calls to their raw call and result"
slug: "operators-pick-the-sidecar-agent-and"
description: "Story 07, part 2 of 2: the agent picker and tool-call expansion. A resume id belongs to one vendor CLI, so a vendor or model change starts a new session. Mock: Anatomy board. CAOS story: https://www.notion.so/3f7a80b719248143a3cfefa1734efe22."
acceptanceCriteria:
  - "A new session picker lists vendors and models from /api/llm/catalog and creates the session with the chosen vendor and model (tested)"
  - "Picking another vendor or model on an open session starts a new session with it and keeps the old session resumable (tested)"
  - "A tool call draws collapsed with its name and a one-line summary, and expands to its raw input and the matching result (tested)"
priority: "high"
source: "caos"
---
