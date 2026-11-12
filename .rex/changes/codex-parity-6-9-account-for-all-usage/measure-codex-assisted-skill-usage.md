---
id: "869bcab8-bc97-42e9-9eb6-4a72c95a49e0"
type: "task"
title: "Measure Codex assisted-skill usage with marks and deltas"
slug: "measure-codex-assisted-skill-usage"
description: "Replace Claude-only discovery/parser assumptions without losing existing Claude behavior. Audit synthetic Codex token_count transcript produced zero messages and tokens.\n\nApproved capture 2026-11-11; implement later only through ndx work under the parent change's stack/baseline/validation discipline. No implementation is part of this capture."
acceptanceCriteria:
  - "Discover supported Codex session/transcript formats and compute the skill's measured delta from a code-written mark."
  - "Correctly handle cumulative counters, nested marks, repeated records, session rollover/resume and partial transcripts without double charging."
  - "Missing or unsupported usage remains explicit instead of claiming zero measured spend."
  - "Update generated skills/help to describe actual supported vendors; no credentials or production transcript content enters fixtures or logs."
priority: "high"
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-6"
source: "ndx-capture"
blockedBy:
  - "6ea1141c-9080-44a8-8442-1d67846b8de0"
---
