---
id: "9c32dda8-0714-4aca-ae95-2bdbf601ebb1"
type: "task"
title: "The hub session drafts GitHub posts, prompts and restack plans for approval and never runs them"
slug: "the-hub-session-drafts-github-posts"
description: "Story 27 (CAOS 3f7a80b7-1924-8188-879f-f674aea13f31). Draft-only outputs. Design §4.3, §6 Draft not do, §7 Draft post; mocks Hub and Cards."
acceptanceCriteria:
  - "Every GitHub write from the hub session is a draft_github_post card naming its project and target; it posts only on Approve, under the operator's gh auth, with cwd set to that project's repoRoot"
  - "A new never-allow-listable broker tool saves side-session prompts, restack plans and release checklists to a path shown and editable on its card; nothing is written before Approve"
  - "Hub run_command accepts only a fixed read-only set per project (ndx status, git worktree list, branch status), each allow-listable; any other argv is refused without a card, and tests cover merge, rebase, push, ndx work and restack argv"
  - "start_work, propose_edit, propose_prd_change, place_change_card and migration_decision are not offered to a hub-scope session"
priority: "low"
source: "caos"
---
