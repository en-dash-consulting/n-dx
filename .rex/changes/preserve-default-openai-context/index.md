---
id: "928417f9-dd5a-4846-ab5b-19f8b846ae42"
type: "change"
title: "Preserve default OpenAI context compaction summaries"
slug: "preserve-default-openai-context"
intent: "User-authorized remediation of PR #1086 review comment discussion_r4623621067: default context.summarize chooses gpt-6-luna, but the OpenAI wrapper invokes the restricted agent-turn codec, so compaction drops history without a summary. Reproduce with unmodified light-tier defaults, use a supported text-summary path without changing intentional model pins or broadening agent admission, and verify summary/context/accounting continuity. Original PR7 tasks remain completed; this is a narrow review follow-up."
acceptanceCriteria:
  - "With unmodified Codex model tiers, compaction uses the default gpt-6-luna summary model successfully and preserves older context in a summary alongside valid retained tool continuations."
  - "Explicit context.summarize model/route pins remain honored; the fix does not widen executable agent-tool capabilities merely to admit a text summarizer."
  - "Summary usage and resolved-model attribution remain accurate, with existing effort/cancellation/error behavior preserved."
  - "A default-configuration regression fails before the fix and passes after it; focused regressions, required cli-dev/scheduler-startup, affected builds/typechecks and scoped patch changeset pass, with fresh mandatory review and intensive gate skipped via the user-authorized CLI flag."
touches:
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "high"
discoveredFrom: {"item":"eb1e2cbe-d12f-4e5d-8038-9aefb0136be4","run":"bcd9519d-bad0-4196-838c-dcb0312bdcc4"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"maxTurns":200,"contextNotes":"Only remediate PR1086 comment https://github.com/en-dash-consulting/n-dx/pull/1086#discussion_r4623621067. Default context.summarize resolves gpt-6-luna but loop wraps text summarization with completeTurn, which rejects Luna before a request and drops old context without summary. Existing compaction test hides bug by overriding light to gpt-6.1-sol. FIRST add a regression using unmodified defaults and reproduce failure, then fix the summary route using the resolved text-capable model while retaining intentional pins, usage/effort/cancellation and tool continuation. Do not broadly advertise new agent-turn capabilities merely to fix text summaries. Official GPT6Luna docs fetched: https://developers.openai.com/api/docs/models/gpt-6-luna supports text output and Responses/ChatCompletions; task path must be truthful. Risk is high in protocol routing, compaction context loss and usage attribution despite narrow diff; heavy gpt-6-astra execution with fresh gpt-6.2-astra review and deterministic fixtures provides adequate verification. Preserve both pins. User authorized this precise remediation and pushes in existing PR7; do not reopen completed original tasks or capture anything else. This new isolated clone is separate from now-PR9 /private/tmp/ndx-parity-pr2; never modify/switch/configure that clone or dirty original. One task actual ndx work invocation only, no loop/subagents/nested reviews. Fresh review mandatory, reviewOptional=false. Latest user requests --skip-test-gate for intensive gates; scoped meaningful tests, required cli-dev/scheduler-startup, changed builds/typechecks and patch changesets still required. DO NOT run pnpm test or scripts/run-all-tests.mjs internally or clear truthful sandbox markers. No credential/liveAPI access required; use disposable synthetic fixtures. Read current affected AGENTS/workflow/policies/release-notes skill. Do not directly finalize status/commit; write .hench-commit-msg.txt for Hench-owned atomic source/PRD completion with bare N-DX-Item trailer. Executor must not push/reply/resolve threads/publish/merge/auto-merge; coordinator owns authorized existing-PR delivery. No PR8/9 work. MaxTurns200; actual Codex remains workspace-write/never/network-disabled. Outer sandbox exception from old clone is NOT reused here."}
tags:
  - "codex-parity"
  - "codex-parity-pr-7"
  - "review-remediation"
  - "approved"
source: "ndx-capture"
blockedBy:
  - "ee45742e-70be-47ff-a5af-22fa9b711412"
---
