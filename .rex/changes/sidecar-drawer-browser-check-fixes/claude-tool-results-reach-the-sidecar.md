---
id: "2cef4b2a-3b4b-4230-88f1-f7842ccdfd71"
type: "task"
title: "Claude tool results reach the Sidecar transcript and hench run events"
slug: "claude-tool-results-reach-the-sidecar"
description: "Found in the M2 browser check (2026-10-28): after a real Claude turn, every expanded tool call in the drawer says 'No result yet'. Cause: parseClaudeStreamLine in packages/llm-client/src/vendor-session-driver.ts has no case for stream-json 'user' lines, which is where Claude puts tool_result content blocks (each with a tool_use_id). Sidecar transcripts and hench's run events (e.g. .hench/runs/9e963a12-5435-4b7c-9e6d-3607066e55ae.events.jsonl) hold no tool_result events at all. Story 07b's 'expands to its raw input and the matching result' is therefore unmet live."
acceptanceCriteria:
  - "parseClaudeStreamLine (or the driver around it) turns a Claude stream-json user line into one tool_result RuntimeEvent per tool_result block, carrying the block's tool_use_id and its text output capped as today; tested with recorded stream-json lines, including a line with two blocks and a block whose content is an array of text parts"
  - "tool_use events carry the tool_use block's id, and the drawer pairs a result with its call by that id, keeping the current order rule only when no id is present (tested)"
  - "A recorded Claude turn fed through the session driver into the registry leaves tool_result frames in the transcript that GET /api/sidecar/sessions/:id/frames returns (tested)"
  - "hench's Claude run loop records the new tool_result events without changing its turn count, completion detection or token totals, and the hench and llm-client suites pass (tested)"
priority: "high"
source: "ndx-capture"
---
