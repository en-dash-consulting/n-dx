---
id: "5e12c9b2-f2d7-4933-a04e-6cfa15992879"
type: "change"
title: "ndx config --help lists no Codex preflight error codes"
slug: "ndx-config-help-lists-no-codex"
intent: "ndx config --help (packages/core/config.js, the \"Claude preflight error codes\" / \"Google preflight error codes\" blocks near line 2652) documents every Claude, Google and local preflight code but has no Codex section. A Codex user whose `ndx config llm.vendor codex` or `ndx auth` prints [NDX_CODEX_PREFLIGHT_AUTH_FAILED] or [NDX_CODEX_PREFLIGHT_NO_KEY] finds neither code in the help. Pre-existing for AUTH_FAILED; found by the adversarial review of e97d3394, which added NDX_CODEX_PREFLIGHT_NO_KEY and listed only the Claude one. Reachable: every Codex preflight failure. Verdict: out-of-scope (low). Fix: add a \"Codex preflight error codes\" block listing every code the Codex preflight emits; optionally a test that every NDX_*_PREFLIGHT_* code emitted in config.js appears in the help. Cost: a few help lines and one test; no risk.\n\n2026-11-24 reconciliation: PR 6 owns current error-code/help reproduction and parity test. Current help lacks a Codex error-code section while config still emits NDX_CODEX_PREFLIGHT_AUTH_FAILED and dynamically emits NO_KEY. Preserve original criteria; no direct API review or auth/account expansion."
acceptanceCriteria:
  - "ndx config --help lists NDX_CODEX_PREFLIGHT_AUTH_FAILED and NDX_CODEX_PREFLIGHT_NO_KEY with their meanings"
  - "A test fails when a NDX_*_PREFLIGHT_* code emitted by packages/core/config.js is missing from ndx config --help"
touches:
  - "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
  - "7e14ce05-95ad-4fa4-adc9-73d0c6742566"
fix: true
priority: "low"
discoveredFrom: {"item":"e97d3394-f0a1-4199-935f-7c7ca4636a87","run":"d9594daf-f4b8-4586-acc0-fb6fc070b8eb"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
  - "help"
  - "codex-hardening"
  - "slot-6"
source: "ndx-adversarial-review"
blockedBy:
  - "f3311428-10bf-4ed0-a4e5-ec6c92722575"
---
