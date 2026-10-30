---
id: "2f15d421-fa29-4464-9ab1-6131e80728a3"
type: "task"
title: "Approved Sidecar commands and work run through the shared job model"
slug: "approved-sidecar-commands-and-work-run"
description: "Story 12 (CAOS https://www.notion.so/3f7a80b7192481f8b679c82db62c39f5), plus task 21fe75a3 for run_command and start_work. The ndx-sidecar broker (packages/web/src/server/sidecar/broker.ts) holds each write call until its card is decided or the call matches the allow-list (broker.allowList(), the Sidecar allow-list file); today an approved call is only recorded in <session>.cards.jsonl and nothing runs. Carry out run_command through the existing command job model in routes-commands.ts (startAsyncJob, commandJobsOf), so the job shows in the active-operations tray (use-active-operations.ts) and on Live. Carry out start_work through the hench execute route in routes-hench.ts: the card shows the task's ndx work --resolve preview before approval, and the run counts against guard.maxConcurrentProcesses (default 3, getEffectiveMaxConcurrent); at the limit it is refused. Each tool result reports what ran (command and job id, or the run started). Every other approved tool reports 'recorded, not carried out yet' and names the batch that will carry it out: place_change_card the L2 Place lens; github_read and draft_github_post L2/H1; migration_decision G1; propose_edit a later batch. propose_prd_change is carried out by the change-set card task (story 11); until then it reports the same recorded line. No node:child_process in web: use the existing exec seams. Mock: Cards and Anatomy boards."
acceptanceCriteria:
  - "An approved or allow-listed run_command runs through the existing command job model, shows in the active-operations tray and on Live, and its tool result names the command and the job id (tested)"
  - "A run_command not on the allow-list raises a permission card and runs nothing until it is approved (tested)"
  - "A start_work card shows the task's ndx work --resolve preview before approval, and approval starts the run through the hench execute route (tested)"
  - "start_work counts against guard.maxConcurrentProcesses; at the limit it starts nothing and its tool result says the limit is reached (tested)"
  - "A denied or withdrawn card runs nothing, and its tool result says so (tested)"
  - "An approved place_change_card, propose_edit, github_read, draft_github_post or migration_decision call reports 'recorded, not carried out yet' with the batch that will carry it out (tested)"
  - "No web module imports node:child_process (policy test passes)"
priority: "high"
source: "caos"
---
