---
id: "b8de0693-928f-4db1-8c72-6d247f62bb96"
type: "change"
title: "Phase 2 PR 1: keep the LoE data the LLM already produces (R0)"
slug: "phase-2-pr-1-keep-the-loe-data-the-llm"
intent: "Prepare task phase 2, PR 1 of 4 (workshop analysis/task-prep/02-task-prep-design.md §7.2 R0). The analyze and add prompts ask for loe (engineer-weeks), loeRationale and loeConfidence on every task, but the folder-tree serializer drops the last two, writes loe as a quoted string, and Smart Add plus both dashboard accept routes never copy the fields: 0 of ~1900 item files have loe. This PR keeps all three on every accept path, round-trips loe as a number, and guarantees no object-valued field is ever written as \"[object Object]\" (the 289 existing corrupted recommendationMeta values are left alone by decision). No new feature surface."
plannedRelease: "0.9.0"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
---
