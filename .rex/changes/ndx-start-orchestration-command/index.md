---
id: "64fcec7c-8979-4771-bcb6-9c48edb75cad"
type: "change"
title: "`ndx start` orchestration command"
slug: "ndx-start-orchestration-command"
intent: "Introduce `ndx start` as the unified entrypoint that starts both the web dashboard and MCP HTTP endpoints on a single port. Supports `--background`, `stop`, `status` (extending the existing `ndx web` pattern). `ndx web` becomes an alias or is deprecated in favor of `ndx start`."
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
tags:
  - "cli"
  - "dx"
---
