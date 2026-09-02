---
id: "b5b46766-b81c-44ac-b259-9a90ea1f4c43"
level: "task"
title: "Define and document supported OS matrix in README and docs"
status: "completed"
priority: "medium"
tags:
  - "docs"
  - "dx"
source: "smart-add"
startedAt: "2026-04-19T04:37:52.665Z"
completedAt: "2026-04-19T04:40:13.435Z"
resolutionType: "code-change"
resolutionDetail: "Added ## Requirements section with platform support table to README.md covering macOS (supported), Linux (supported), Windows WSL2 (supported), and Windows native (experimental)."
acceptanceCriteria:
  - "README contains a platform support table covering macOS, Linux, and Windows (native and WSL)"
  - "Each OS row states support level: supported, experimental, or unsupported with a brief note"
  - "Windows Docker path is referenced or linked where Windows native is unsupported"
  - "Table matches actual CI/gauntlet configuration — no aspirational claims without test coverage"
description: "Audit what platforms n-dx actually supports (macOS, Linux, Windows native vs WSL vs Docker) by reviewing CI configuration, existing gauntlet tests, and any known Windows-specific workarounds. Produce a concise support matrix table and place it in the README under a 'Requirements' or 'Platform Support' section. Mark Windows native as unsupported/experimental if appropriate, referencing the Docker path documented in the gauntlet infrastructure work."
---
