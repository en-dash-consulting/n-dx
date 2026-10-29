---
id: "55faa034-3df0-41a1-9aef-67d1dc896340"
type: "task"
title: "Sidecar explains why a branch failed CI or conflicts, with next steps"
slug: "sidecar-explains-why-a-branch-failed"
description: "Diagnose branch lens (story 24) over R2's branch health (collectBranchHealth, check and conflict classes). Carries out the github_read and draft_github_post broker calls that carry-out.ts reserves for L2. Design §5 Diagnose branch (Q6), §7 Network read and Draft post."
acceptanceCriteria:
  - "LENS_PACKETS['diagnose-branch'] is a packet with an 8k cap built from collectBranchHealth for the attached worktree: branch, base, PR, stack position and containment, ahead/behind, each failing check with class, evidence and capped log tail, each predicted conflict with class and fix"
  - "A Workspaces worktree card attaches to the drawer as a new 'worktree' item kind whose ref is the workspace key and whose default lens is diagnose-branch; with none attached the lens is unavailable and names 'a branch or worktree'"
  - "While git.branchHealth is off the lens is unavailable and names git.branchHealth, with no partial packet (tested)"
  - "The answer names each failing check and its class: touched test, failing on main, behind base, policy test, CodeQL or fork; 'failing on main' is decided by a github_read of the same check on the base branch, never guessed"
  - "Each conflict class gets the §5 Q6 fix on its card: PRD children table and generated file as run_command, allowlist union as propose_edit, duplicate capture as propose_prd_change"
  - "A source conflict is never auto-fixed: the answer names the worktree that owns the branch and offers no fix card (tested)"
  - "GitHub reads go only through github_read, carried out by carry-out.ts, with web.sidecarGithubReads on as its per-project allowance; with it off each read raises a network-read card"
  - "GitHub writes go only through draft_github_post, carried out by carry-out.ts: it posts under the operator's gh auth only on Approve, and Copy or Discard posts nothing (tested)"
  - "git and gh run only through the llm-client exec helpers; no node:child_process in web"
source: "ndx-capture"
---
