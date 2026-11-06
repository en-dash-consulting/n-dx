---
id: "6c539e7a-ae0b-4a82-955d-313f596add75"
type: "task"
title: "ndx config --test-connection tests a key held in the credential store"
slug: "ndx-config-test-connection-tests-a-key"
description: "Should-fix from the #949 review. The --test-connection path in packages/core/config.js (~line 3191, `if (claudeConfig.api_key)`) tests only a config-file key. Since #949 the api_key alias writes the store and leaves only llm.claude.auth: api in .n-dx.local.json, so after `ndx config claude.api_key …` --test-connection exits 1 with 'No claude.api_key or claude.cli_path configured to test.' Resolve the key the way the API provider does (resolveVendorAuth / resolveVendorApiKey for the vendor, via llm-client), and never print it."
acceptanceCriteria:
  - "After ndx config claude.api_key <key> (key in the store, auth api), ndx config --test-connection tests that key"
  - "With auth cli, --test-connection does not test a stored key as the API credential"
  - "No output contains the key value"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
