---
id: "3ba18674-382b-41b1-b682-a1a652a273e2"
type: "task"
title: "Saving the agent prompt follows a dangling symlink out of the project"
slug: "saving-the-agent-prompt-follows-a"
summary: "The agent prompt file could be written outside the project when its path was a broken link pointing outside; it is now refused."
description: "Review 4672392623 (P1): packages/llm-client/src/agent-prompt.ts:97. realpathSync throws on a dangling symlink and the containment check falls back to the link's parent, so writeAgentPrompt follows `.ndx/agent-prompt.md -> ../../outside.md` and creates the external file. Fix: lstat/readlink each existing path segment; resolve a symlink's target (relative to its directory) before the ancestor fallback, and refuse a dangling link whose target leaves the project."
acceptanceCriteria:
  - "A dangling symlink at the prompt path pointing outside the project is refused and nothing is created outside"
  - "Both the default and a configured prompt path are covered by tests"
priority: "critical"
source: "pr-review"
---
