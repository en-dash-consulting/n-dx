---
id: "9b84419e-8e81-4f09-826f-c5ec2edaef5d"
type: "change"
title: "Keep PR2 pricing coverage separate from model selection and remove stale run evidence"
slug: "keep-pr2-pricing-coverage-separate"
summary: "Keep broader pricing estimates from changing which Codex models the dashboard offers. Keep architecture documentation focused on enduring behavior rather than an outdated run log."
intent: "User requested review-comment remediation on 2026-11-19 for PR #1058 at head72ff8efe0997769ddca7ac02a0e3f98f0e70667d. Address exactly review comments https://github.com/en-dash-consulting/n-dx/pull/1058#discussion_r4631642073 and https://github.com/en-dash-consulting/n-dx/pull/1058#discussion_r4631642091. The reviewer confirmed routes-llm cloudVendorModels derives the built-in model list from MODEL_COSTS, unintentionally expanding the Codex built-in list from five to seventeen when pricing metadata was refreshed. Decouple Codex selection from price coverage, retaining PR2's pre-refresh five-model built-in fallback and legitimate live-probe validation behavior. Preserve Claude/Google behavior, literal execution pins, all price/context metadata and the deferred PR3 catalog/default scope. Remove the Implementation validation (2026-11-16) section from docs/architecture/openai-model-metadata.md while keeping its dated sources and interpretation. That run evidence already exists in the PR/run/external handoff and must not remain as pending finalization prose in architecture docs. Do not refresh current model prices/defaults/catalogs, restack downstream PRs, fix unrelated failures, merge, or enable auto-merge. Existing /private/tmp/ndx-parity-pr2 is occupied by PR9; never write/switch it or the original dirty checkout. All work is isolated in /private/tmp/ndx-parity-pr2-review."
acceptanceCriteria:
  - "The PR2 dashboard built-in Codex catalog/fallback remains exactly its pre-pricing-refresh five-model set; seventeen priced models do not become selectable solely because MODEL_COSTS contains them."
  - "Regression coverage proves pricing-only model IDs are absent from the built-in/fallback catalog and are refused by execute validation when the live probe fails, while legitimate live-only models remain accepted when actually reported. Preserve other vendors' behavior and literal pins without changing price/context data."
  - "Remove the stale Implementation validation (2026-11-16) run-log section from the architecture document; preserve source and interpretation sections. Keep truthful final review/gate evidence in PR/run/external records instead."
  - "Pass scoped regression tests, required cli-dev/scheduler-startup checks, affected web build/typecheck and mandatory affected gate. Include a scoped @n-dx/web patch changeset and atomic code/PRD completion commit with bare N-DX-Item trailer; mandatory fresh Astra self-review."
touches:
  - "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
priority: "high"
discoveredFrom: {"item":"8d9405d1-a805-4254-b91f-36ed91469452","run":"569fdfab-4c1e-46c8-8a14-c795eb47285a"}
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Standard Sol is adequate for this bounded route-catalog regression plus deletion of stale run prose; fresh mandatory heavy Astra self-review checks catalog/fallback/execute consistency and scope isolation. Keep client-default medium effort; no product effort plumbing. No auxiliary subagents or parallel model runs: framework owns mandatory fresh review and the host allows at most two logical runs across chats/vendors. Actual checkout-local ndx work owns claim/log/completion/atomic commit. Never write original /Users/ryankeith/ndx-core/n-dx or occupied /private/tmp/ndx-parity-pr2. No global config, credential changes, model/auth fallback, merge/auto-merge, downstream restack, unapproved capture or unrelated source fixes. External disposable fixture homes only. Node22.22.2/pnpm10.33.0 and VITEST_MAX_WORKERS=2. Current clone keeps sandbox.mode=on/network=allow; no NDX_SANDBOX=off exception has been extended to this fresh review clone. Codex must remain workspace-write/network-disabled; do not clear truthful inner sandbox markers or bypass confinement. Required startup checks and affected gate are mandatory. Hench autoCommit=false: write .hench-commit-msg.txt sentinel with exact attribution if sandbox staging is denied; Hench finalizes. Never git add -A or git add .; do not manually complete PRD state. Read current AGENTS/workflow/package instructions and release-notes skill before changeset. Preserve original price/context sources dated 2026-11-16; this task does not require new pricing research. The prior external handoff is historical: /Users/ryankeith/.codex/visualizations/2026/11/16/01a1e509-e563-7b13-8664-de7809a902e8/codex-parity-pr2-handoff.txt. Current remote PR2 head/base and review feedback override its old topology."}
tags:
  - "codex-parity"
  - "codex-parity-pr-2"
  - "review-remediation"
  - "approved"
source: "ndx-capture"
blockedBy:
  - "0c727192-938b-46d8-b068-2e7022139750"
---
