---
id: "4aa01e0c-31d5-4db0-9386-214b01da32dd"
level: "feature"
title: "Workflow Skill Wording & Termination Clarity"
status: "pending"
priority: "high"
tags:
  - "prompts"
  - "skills"
  - "workflows"
blockedBy:
  - "76076f6a-c23c-4905-864b-5218a5a6ee69"
source: "ndx-capture"
acceptanceCriteria:
  - "Every skill opens with its single intended outcome, so the agent knows what done looks like before reading the steps."
  - "Every skill names its terminating action explicitly, so a run stops on the intended change rather than continuing into optional follow-up work."
  - "Steps that restate an MCP tool's own documented behaviour are replaced by the tool call, and steps describing removed code paths are deleted."
  - "Conditional branches are stated as a decision the agent makes once up front, not re-litigated at each step."
  - "Shell-dependent instructions are expressed so they work on the platforms the repo supports, with no assumption that Git Bash is present on Windows."
  - "Skill invocation token cost drops measurably against the recorded baseline for the long skills, with the short ones left alone where they are already minimal."
  - "Each rewritten skill is exercised once end to end and reaches the same outcome as before the rewrite."
description: "Rewrite the 13 project workflow skills under .claude/skills/ so each one drives the agent to its intended outcome by the shortest path. Sizes vary widely (iso-map 121 lines, ndx-adversarial-review 107, triage 86, down to ndx-zone at 12), and the long ones carry the most restated context and the most conditional branching. Each skill needs a stated goal, an explicit stopping condition, and no step that duplicates what the hench brief or the MCP tool descriptions already supply."
lastModified: "2026-09-08T13:08:14.310Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
