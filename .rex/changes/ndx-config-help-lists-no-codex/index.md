---
id: "5e12c9b2-f2d7-4933-a04e-6cfa15992879"
type: "change"
title: "ndx config --help lists no Codex preflight error codes"
slug: "ndx-config-help-lists-no-codex"
intent: "ndx config --help (packages/core/config.js, the \"Claude preflight error codes\" / \"Google preflight error codes\" blocks near line 2652) documents every Claude, Google and local preflight code but has no Codex section. A Codex user whose `ndx config llm.vendor codex` or `ndx auth` prints [NDX_CODEX_PREFLIGHT_AUTH_FAILED] or [NDX_CODEX_PREFLIGHT_NO_KEY] finds neither code in the help. Pre-existing for AUTH_FAILED; found by the adversarial review of e97d3394, which added NDX_CODEX_PREFLIGHT_NO_KEY and listed only the Claude one. Reachable: every Codex preflight failure. Verdict: out-of-scope (low). Fix: add a \"Codex preflight error codes\" block listing every code the Codex preflight emits; optionally a test that every NDX_*_PREFLIGHT_* code emitted in config.js appears in the help. Cost: a few help lines and one test; no risk."
acceptanceCriteria:
  - "ndx config --help lists NDX_CODEX_PREFLIGHT_AUTH_FAILED and NDX_CODEX_PREFLIGHT_NO_KEY with their meanings"
  - "A test fails when a NDX_*_PREFLIGHT_* code emitted by packages/core/config.js is missing from ndx config --help"
touches:
  - "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
priority: "low"
discoveredFrom: {"item":"e97d3394-f0a1-4199-935f-7c7ca4636a87","run":"d9594daf-f4b8-4586-acc0-fb6fc070b8eb"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
  - "help"
source: "ndx-adversarial-review"
---
