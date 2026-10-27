---
id: "e3b7ea79-3e89-4452-854d-f159a7ada1f4"
type: "change"
title: "Add Google model tier constants, context-window sizes, and budget definitions to llm-client"
slug: "add-google-model-tier-constants"
intent: "Extend the model tier registry and vendor budget configuration in llm-client to include Google Gemini model IDs for each task weight (light, standard, heavy). Define per-model context window sizes and cost-per-token constants used by budget preflight and percent-remaining calculations. Wire into resolveVendorModel so existing resolution logic handles the google vendor branch."
acceptanceCriteria:
  - "GOOGLE_MODELS constant exported from llm-client lists at least three Gemini model IDs with tier assignments"
  - "resolveVendorModel('google', weight) returns a valid Gemini model ID for light, standard, and heavy weights"
  - "Per-model context window and cost constants are present and consumed by the shared budget preflight"
  - "Existing Claude and Codex tier resolution is unaffected by the additions"
  - "Unit tests verify tier resolution and budget calculation for at least two Google models"
amends: [{"target":"88b055ba-6307-4785-ba00-3ebf8e8945ee","delta":"modified","summary":"Add Google model tier constants, context-window sizes, and budget definitions to llm-client","base":"eb123ee6c9ff97c264c3d0908c1a7410e8536eee594323d2713fb5609cce49dc"}]
priority: "high"
tags:
  - "llm-client"
  - "google"
  - "model-registry"
source: "smart-add"
---
