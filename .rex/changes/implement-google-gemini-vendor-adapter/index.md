---
id: "1fcf2fde-2524-4dc5-a962-a6d9caa9feb4"
type: "change"
title: "Implement Google Gemini vendor adapter in llm-client"
slug: "implement-google-gemini-vendor-adapter"
intent: "Add a google adapter module to packages/llm-client following the existing claude and codex adapter shapes. Covers API client initialization (via @google/generative-ai SDK or REST), n-dx-to-Gemini message format translation, streaming SSE normalization, and mapping of rate-limit, token-exhaustion, and bad-response errors into the shared LLMErrorKind enum so downstream error handling requires no changes."
acceptanceCriteria:
  - "Adapter exports a factory compatible with the existing vendor adapter interface used by Claude and Codex adapters"
  - "Supports at least gemini-2.0-flash and gemini-2.5-pro model IDs at adapter construction time"
  - "Translates n-dx message format to Gemini API request format and unmarshals responses back to shared output types"
  - "Streaming responses emit incremental text tokens via the shared streaming output interface"
  - "Rate-limit and quota errors are classified into the shared LLMErrorKind enum"
  - "Unit tests cover happy-path completion, streaming output, rate-limit error classification, and invalid-model-id rejection"
amends: [{"target":"88b055ba-6307-4785-ba00-3ebf8e8945ee","delta":"modified","summary":"Implement Google Gemini vendor adapter in llm-client","base":"eb123ee6c9ff97c264c3d0908c1a7410e8536eee594323d2713fb5609cce49dc"}]
priority: "critical"
tags:
  - "llm-client"
  - "google"
  - "backend"
source: "smart-add"
---
