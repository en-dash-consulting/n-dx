---
id: "bbc6ffa4-3df7-423e-b4a7-9161feffbcc2"
type: "change"
title: "Add Google provider selection and API key preflight to ndx init"
slug: "add-google-provider-selection-and-api"
intent: "Extend the interactive provider selection prompt in ndx init to include google as a third option (alongside claude and codex). After selection, prompt for a Google API key, validate it with a lightweight preflight call to the Gemini API, and persist llm.vendor=google and llm.google.model to .n-dx.json. Mirror the existing Claude and Codex init branch structure and re-init idempotency guard."
acceptanceCriteria:
  - "ndx init --provider=google completes without error when a valid GEMINI_API_KEY is present"
  - "Interactive provider prompt lists google as a selectable option"
  - "An invalid or missing API key produces an actionable error message with remediation steps pointing to the Google AI Studio key page"
  - "Successful preflight stores llm.vendor=google and llm.google.model to .n-dx.json"
  - "ndx init with an existing valid Google config skips the provider re-prompt"
  - "Integration test covers the google init happy path and missing-key failure path"
amends: [{"target":"14172800-bb65-47da-91cc-4385c611cd5d","delta":"modified","summary":"Add Google provider selection and API key preflight to ndx init","base":"1d5d9675da6b516614457529015e69112b0242fcc0f88420c2eba445e198ef93"}]
priority: "critical"
tags:
  - "cli"
  - "init"
  - "google"
  - "auth"
source: "smart-add"
---
