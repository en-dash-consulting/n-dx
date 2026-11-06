---
id: "aa7c1ae3-2e86-4c4f-9bfb-9403299a496a"
type: "task"
title: "Your tooling tile on Tune (read-only)"
slug: "your-tooling-tile-on-tune-read-only"
description: "A 4×2 Tune tile summarising what this project can run on, read from the config and credential status the Settings pages already read: each vendor CLI (Claude Code, Codex, local models) with connected / signed out / missing, the model for each tier (light, standard, heavy) per vendor, per-command route overrides, and review pairing. Nothing on the tile edits: each line links to its Settings › Robot Wrangler or Workflow field. Leave a slot for the Sidecar and connections lines S8 adds."
acceptanceCriteria:
  - "The tile lists each vendor CLI with its state, the model per tier, per-command overrides and review pairing"
  - "Every line links to the Settings field that changes it, and the tile has no editable control"
  - "A missing or signed-out vendor shows its state without breaking the tile"
  - "A unit test renders the tile from fixture config"
priority: "low"
source: "ndx-capture"
---
