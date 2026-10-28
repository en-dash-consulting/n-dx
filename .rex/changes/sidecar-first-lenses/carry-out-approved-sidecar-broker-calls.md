---
id: "21fe75a3-8af7-4ce7-9fbd-08549905bb5b"
type: "task"
title: "Carry out approved Sidecar broker calls"
slug: "carry-out-approved-sidecar-broker-calls"
description: "Moved from M1's change (9753d37a) into M3 and narrowed (decided 2026-10-28). The broker holds every write call until its card is decided or the call matches the allow-list, then only records the outcome in <session>.cards.jsonl. M3 carries out the tools its lenses need: run_command and start_work in the job-model task (story 12), propose_prd_change in the change-set card task (story 11). Every other tool reports 'recorded, not carried out yet' with its batch: place_change_card L2 Place lens; github_read and draft_github_post L2/H1; migration_decision G1; propose_edit a later batch. No run of its own: verify once stories 12 and 11 are done, then mark completed."
acceptanceCriteria:
  - "An approved or allow-listed run_command, start_work or propose_prd_change runs its effect, and the tool result reports what ran (verified through stories 12 and 11)"
  - "Every other approved broker tool reports 'recorded, not carried out yet' and names its batch (verified through story 12)"
  - "A denied or withdrawn card runs nothing"
  - "No web module imports node:child_process"
priority: "medium"
tags:
  - "sidecar"
  - "follow-up"
source: "hench-follow-up"
---
