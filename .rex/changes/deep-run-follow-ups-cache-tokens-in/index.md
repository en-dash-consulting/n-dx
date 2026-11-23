---
id: "140e0c03-294f-4e8d-9870-83cd3761ae04"
type: "change"
title: "Deep-run follow-ups: cache tokens in the run ledger and splitting oversized Jev requests"
slug: "deep-run-follow-ups-cache-tokens-in"
summary: "The first deep run with PR 13's fixes still under-reported what Claude calls cost, and lost severity judgments whenever a judgment request grew too large. This records the full cost and keeps judging large repositories in smaller pieces."
intent: "PR 13b, stacked on PR 13 (feat/sv-php-pr13-estate-quality, head 5ab900a0d). It comes from the reference repository's deep run (`analyze --deep --full --wait`) on 5ab900a0d, 2026-11-17, reported by the engagement scan session as counts only. That run confirmed #12 (the primer is written) and the escalation batching (code.classify/claude went from 95 calls to 1). It also found two problems:\n\n1. The run ledger still under-counts Claude CLI calls. The rows now have tokens, but only uncached input; about 391k prompt-cache tokens are left out. The CLI caches its own system prompt on every call. For example, the Haiku transcripts held 128 input, 245,057 cache-read and 88,093 cache-write tokens.\n2. Typed-finding judgment failed 4 times, once per enrichment pass, with `TypeSafe returned 400: {\"detail\":{\"error_type\":\"max_tokens_exceeded\"}}`. On that error judgment stops for every finding left, which keep their derived severities. The summary line still says \"48 judged in 1 request(s)\", although at most 20 were.\n\nPrivacy rule: no client name, repo name, path or finding text in this repository. Fixtures and test data are invented.\n\nLane rules: every code change goes through `ndx work`. Targeted unit tests only; CI (ci:run) runs the suites. Output is byte-identical when a run has no cache tokens and no oversized request. Patch changesets with scoped names."
acceptanceCriteria:
  - "A deep run's ledger rows and printed token lines include the Claude CLI's prompt-cache tokens, and the run cost prices them at cache rates"
  - "A Jev request TypeSafe refuses as too large is split into smaller requests until each fits, for typed-finding judgment and file classification"
  - "The typed-finding summary line counts only findings that were judged"
  - "Each task has targeted unit tests on invented data and a patch changeset"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
discoveredFrom: {"item":"c105a2c0-92f5-4e2f-ad3f-9e6a913d75d3"}
tags:
  - "sourcevision"
  - "llm-client"
  - "php-pr13"
---
