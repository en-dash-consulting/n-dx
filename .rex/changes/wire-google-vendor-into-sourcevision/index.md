---
id: "6f950a55-accb-4437-a896-80da29fa986a"
type: "change"
title: "Wire Google vendor into sourcevision analyze LLM path"
slug: "wire-google-vendor-into-sourcevision"
intent: "sourcevision analyze drives several LLM passes (zone enrichment, findings generation, next-steps scoring). These passes call resolveVendorModel but may not handle the google vendor branch, falling back silently. Update the analyze pipeline to route all LLM invocations through the Google adapter when `llm.vendor=google`, and ensure the vendor header is printed in analyze output and any LLM errors surface through the shared classifier."
acceptanceCriteria:
  - "`ndx analyze` and `ndx plan` complete successfully with `llm.vendor=google` set and output a valid CONTEXT.md"
  - "The vendor/model header in analyze output shows the resolved Google model"
  - "LLM error classification (rate limit, budget, bad response) works for Google failures during analyze"
  - "No silent fallback to Claude or Codex occurs when vendor=google and an API key is present"
touches:
  - "ae9b2c95-002c-4f08-aefb-f86e7f85cebe"
priority: "medium"
tags:
  - "google"
  - "sourcevision"
  - "llm-client"
source: "smart-add"
---
