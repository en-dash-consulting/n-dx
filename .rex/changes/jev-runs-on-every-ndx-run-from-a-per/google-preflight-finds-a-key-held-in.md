---
id: "1ef2f885-15d8-454a-839a-19c2a1f6422f"
type: "task"
title: "Google preflight finds a key held in the credential store"
slug: "google-preflight-finds-a-key-held-in"
description: "Must-fix from the #949 stack review, made the main path by #952. runGoogleApiPreflight in packages/core/config.js (~line 947) still reads only google.api_key or process.env[apiKeyEnv]. Since #949, `ndx config llm.google.api_key …` writes the credential store and removes the file copy, and #952's dashboard init wizard and preflight message both send users to `ndx config credentials.google`. Result: a later `ndx config llm.vendor google .` exits 1 with NDX_GOOGLE_PREFLIGHT_NO_KEY and tells the user to run the command they just ran; `ndx auth` fails the same way, so every wizard-created Google project fails auth. config.js is orchestration tier: it may not import the store module directly for this, so resolve through llm-client the way loadLLMConfig is already reached here (dynamic import of @n-dx/llm-client, resolveVendorKey/resolveVendorAuth for google), or spawn the credentials CLI. Never print the value."
acceptanceCriteria:
  - "With the Google key only in the credential store (file backend), ndx config llm.vendor google succeeds without --soft-preflight"
  - "ndx auth reports Google authenticated when the key is only in the credential store"
  - "An exported GEMINI_API_KEY (or the configured apiKeyEnv) still takes precedence over the stored key"
  - "With no key in config, env or store, the preflight still fails with NDX_GOOGLE_PREFLIGHT_NO_KEY and names ndx config credentials.google"
  - "No preflight output or error contains the key value"
priority: "high"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
