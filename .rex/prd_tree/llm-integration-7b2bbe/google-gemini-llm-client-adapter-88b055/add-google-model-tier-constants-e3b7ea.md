---
id: "e3b7ea79-3e89-4452-854d-f159a7ada1f4"
level: "task"
title: "Add Google model tier constants, context-window sizes, and budget definitions to llm-client"
status: "completed"
priority: "high"
tags:
  - "llm-client"
  - "google"
  - "model-registry"
source: "smart-add"
startedAt: "2026-06-05T12:20:17.785Z"
completedAt: "2026-06-05T12:38:57.039Z"
endedAt: "2026-06-05T12:38:57.039Z"
resolutionType: "code-change"
resolutionDetail: "Added GOOGLE_MODELS, heavy tier to TaskWeight/TIER_MODELS, MODEL_CONTEXT_WINDOWS, MODEL_COSTS, and budget-preflight.ts module with 25 new tests."
acceptanceCriteria:
  - "GOOGLE_MODELS constant exported from llm-client lists at least three Gemini model IDs with tier assignments"
  - "resolveVendorModel('google', weight) returns a valid Gemini model ID for light, standard, and heavy weights"
  - "Per-model context window and cost constants are present and consumed by the shared budget preflight"
  - "Existing Claude and Codex tier resolution is unaffected by the additions"
  - "Unit tests verify tier resolution and budget calculation for at least two Google models"
description: "Extend the model tier registry and vendor budget configuration in llm-client to include Google Gemini model IDs for each task weight (light, standard, heavy). Define per-model context window sizes and cost-per-token constants used by budget preflight and percent-remaining calculations. Wire into resolveVendorModel so existing resolution logic handles the google vendor branch."
---
