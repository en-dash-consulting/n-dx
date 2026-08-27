---
id: "58171595-a659-490f-9c23-51044bfeb502"
level: "task"
title: "/ndx-adversarial-review topic mode guesses slugs against get_item, which has no search"
status: "completed"
priority: "medium"
tags:
  - "skills"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-08-21T14:10:12.574Z"
completedAt: "2026-08-21T14:12:18.027Z"
endedAt: "2026-08-21T14:12:18.027Z"
resolutionType: "code-change"
resolutionDetail: "Topic mode now enumerates .rex/prd_tree/ using the same phrasing as the duplicate-check step, names get_prd_status for epic-level shape, and reframes get_item as fetch-by-known-ID. Guess-a-slug instruction removed. Full root e2e green (1238 passed)."
acceptanceCriteria:
  - "Step 1's topic mode names enumerating `.rex/prd_tree/` as the primary resolution method"
  - "The instruction to call `get_item` on guessed slugs is removed"
  - "`get_prd_status` is named as the way to get epic-level shape"
  - "The resolution technique matches the one used by the duplicate-check step"
description: "**Severity:** medium — **Verdict:** should-fix\n\n**Failure scenario.** A user runs `/ndx-adversarial-review token usage` against a PRD with 940 items. Step 1's topic mode says to search \"`get_item` on likely slugs\" — but rex MCP exposes no search tool (enumerated in `packages/rex/src/cli/mcp.ts`; the closest is `get_prd_status`, which returns epics only), and `get_item` requires an exact ID with no fuzzy matching. Slug guessing fails, and the mode the user reached for degrades into trial and error.\n\nThe reliable method — enumerating the directories under `.rex/prd_tree/`, whose names *are* the slugs and whose nesting mirrors the hierarchy — is mentioned second and parenthetically. Confirmed during this review: enumerating the tree resolved a parent in one command after `get_item` on an epic ID blew the token limit.\n\n**Evidence.** `packages/core/assistant-assets/skills/ndx-adversarial-review.md` — Step 1, topic-mode bullet.\n\n**Reachability.** Every topic-mode invocation — the entry mode specifically requested when the skill was designed.\n\n**Possible solutions.**\n1. *Recommended.* Reorder the instruction: enumerate `.rex/prd_tree/` as the primary resolution method, use `get_prd_status` for epic-level shape, and delete the guess-a-slug instruction. Pure prose change, no new dependencies. This also matches the duplicate-check step, which already enumerates the tree — one technique instead of two.\n2. Add a `search_items` tool to rex MCP and call it here. The real fix and useful beyond this skill, but it is a rex feature rather than a skill edit, and should be tracked separately if wanted."
---
