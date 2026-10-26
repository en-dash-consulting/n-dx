---
id: "adba5290-d3e8-4d4c-89e0-bfcf456f0c85"
type: "task"
title: "Server keeps a per-worktree Sidecar session registry with TTL and transcripts"
slug: "server-keeps-a-per-worktree-sidecar"
description: "Registry keyed by scope + worktree, persisted to .hench/sidecar/index.json, transcripts as JSONL. CAOS story: https://www.notion.so/3f7a80b719248165891cff1c8f0d0ace."
acceptanceCriteria:
  - "sessions survive a server restart via the stored resume id"
  - "idle sessions forget their resume id after the TTL (default 2 h)"
  - "transcripts are machine-local and gitignored"
priority: "high"
source: "caos"
---
