---
id: "21fe75a3-8af7-4ce7-9fbd-08549905bb5b"
type: "task"
title: "Carry out approved Sidecar broker calls"
slug: "carry-out-approved-sidecar-broker-calls"
description: "The ndx-sidecar broker (story 04) holds every write call until its card is decided or the call matches the allow-list. It then only tells the model the outcome: an approved call is recorded in <session>.cards.jsonl and nothing runs. Carrying out each approved call belongs with the Sidecar integration feature: run_command goes to the job tray runner, start_work to the hench execute route with its --resolve preview, propose_prd_change and place_change_card to the one-door PRD write path under withTransaction, propose_edit to an edit apply, github_read and draft_github_post to gh through the llm-client exec helpers, and migration_decision to the migration review file. Each tool result must then report what ran. Decide whether this belongs in this change or in the integration feature, and place it there."
acceptanceCriteria:
  - "an approved or allow-listed call runs its effect and the tool result reports what ran"
  - "a denied or withdrawn card runs nothing"
  - "no web module imports node:child_process"
priority: "medium"
tags:
  - "sidecar"
  - "follow-up"
source: "hench-follow-up"
---
