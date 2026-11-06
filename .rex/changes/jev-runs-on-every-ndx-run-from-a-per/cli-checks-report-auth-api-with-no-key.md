---
id: "e97d3394-f0a1-4199-935f-7c7ca4636a87"
type: "task"
title: "CLI checks report auth api with no key instead of throwing"
slug: "cli-checks-report-auth-api-with-no-key"
description: "Should-fix from the #949 review. loadVendorCheckEnv in packages/core/config.js (~line 3044) now rethrows an auth-reason error. runVendorAuthPreflight calls it (~line 1835) outside its try, so it throws instead of returning { ok: false }; --soft-preflight, which ndx init uses, crashes instead of 'Proceeding anyway'. testCliPath only runs --version, which needs no key, yet codex cli_path validation and --test-connection fail when auth api has no usable key — including a locked password-manager helper. web/src/server/llm-catalog.ts forces auth: 'cli' for exactly this kind of probe; do the same for --version probes and catch inside runVendorAuthPreflight."
acceptanceCriteria:
  - "With llm.<vendor>.auth api and no usable key, runVendorAuthPreflight returns { ok: false } naming the missing key instead of throwing"
  - "ndx init with --soft-preflight proceeds under auth api with no key"
  - "cli_path validation (--version) succeeds under auth api with no usable key, and runs no helper"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "core"
source: "stack review of #942/#949/#952 (2026-11-03)"
---
