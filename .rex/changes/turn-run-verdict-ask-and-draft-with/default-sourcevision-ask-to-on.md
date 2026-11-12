---
id: "31ec674c-a57d-4b2a-a93f-e254fbe2f8f5"
type: "task"
title: "Default sourcevision.ask to on"
slug: "default-sourcevision-ask-to-on"
description: "Set defaultValue to true in FEATURE_REGISTRY and every viewer fallback for it (main.ts, views/stage-pages.ts and any Explain-button entry point); the self-enforced gate in routes-sourcevision-ask.ts and the capture-ask/apply-refinements gates stay. Update tests that assume it is off."
acceptanceCriteria:
  - "With nothing stored, the Ask page and the Explain buttons show"
  - "Storing false hides every entry point, and /api/sourcevision/ask, /api/rex/capture-ask and /api/rex/apply-refinements refuse"
priority: "low"
tags:
  - "feature-flags"
source: "ndx-capture"
---
