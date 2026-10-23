---
id: "b5b46766-b81c-44ac-b259-9a90ea1f4c43"
type: "change"
title: "Define and document supported OS matrix in README and docs"
slug: "define-and-document-supported-os"
intent: "Audit what platforms n-dx actually supports (macOS, Linux, Windows native vs WSL vs Docker) by reviewing CI configuration, existing gauntlet tests, and any known Windows-specific workarounds. Produce a concise support matrix table and place it in the README under a 'Requirements' or 'Platform Support' section. Mark Windows native as unsupported/experimental if appropriate, referencing the Docker path documented in the gauntlet infrastructure work."
acceptanceCriteria:
  - "README contains a platform support table covering macOS, Linux, and Windows (native and WSL)"
  - "Each OS row states support level: supported, experimental, or unsupported with a brief note"
  - "Windows Docker path is referenced or linked where Windows native is unsupported"
  - "Table matches actual CI/gauntlet configuration — no aspirational claims without test coverage"
touches:
  - "087ff59e-ba8c-4be6-a975-a5c170362498"
priority: "medium"
tags:
  - "docs"
  - "dx"
source: "smart-add"
---
