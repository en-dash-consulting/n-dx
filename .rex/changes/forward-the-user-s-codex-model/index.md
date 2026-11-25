---
id: "fc02c0b7-84e9-4f2f-9bf0-62687ac0933b"
type: "change"
title: "Forward the user's Codex model provider into Sidecar turns through -c overrides"
slug: "forward-the-user-s-codex-model"
intent: "Follow-up to the #1008 review (Hal, 2026-11-09). Codex Sidecar sessions now refuse when the user's ~/.codex/config.toml selects a model provider other than openai, because `--ignore-user-config` drops `model_provider` and `[model_providers.*]`. The fuller fix forwards the selected provider through `-c`: `-c model_provider=<id>` plus `-c model_providers.<id>.<key>=<value>` for each key of its table (name, base_url, env_key, wire_api, query_params, http_headers and the rest), so Azure and other providers work in the Sidecar without loading the rest of the user's config. Needs verification on the real Codex CLI, and care that no forwarded value carries a credential into argv (env_key names a variable; http_headers values may be secrets, so use env_http_headers or refuse).\n\n2026-11-24 reconciliation: PR 5 owns the retained real Azure-account criterion. Selected-provider forwarding/isolation landed in #1093 (5d47b98c), so do not recreate it. Preserve the original structured Azure criterion unchanged: local Responses/MCP protocol fixtures and selected-CLI probes are not a real Azure account. If an existing authorized Azure account is unavailable, leave this item and dependent acceptance open and report the evidence blocker; do not create accounts or silently narrow scope."
acceptanceCriteria:
  - "An Azure-configured user's Codex Sidecar turns authenticate with the forwarded provider, verified on the real Codex CLI, with no credential in argv"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "low"
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "codex-hardening"
  - "slot-5"
source: "hub-pr3"
blockedBy:
  - "4fb6419e-6d59-4e91-836f-e759c79fe327"
---
