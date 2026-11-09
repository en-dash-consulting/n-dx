---
id: "2337bb92-a7bc-4e91-a886-e727b1a182a3"
type: "change"
title: "Codex Sidecar broker calls require approval and never reach their cards"
slug: "codex-sidecar-broker-calls-require"
intent: "Finding 2, PR #1008; packages/web/src/server/sidecar/spawn-policy.ts:214-220. With the current flags a real codex-cli 0.164.0-alpha.11.1 lists ndx-sidecar tools but returns \"MCP tool call requires approval, but approval policy is never\" for ask_choice and propose_status. No card reaches the broker. argv mocks all pass. A disposable live probe using the production registry, HTTP broker and status actions verified that adding only -c mcp_servers.ndx-sidecar.default_tools_approval_mode=\"approve\" fixes fresh/resumed calls: choice waits, an approved status changes a scratch task to deferred, shell writes remain denied, the broker header variable remains empty in shell, and Stop withdraws a waiting card. Evidence: /private/tmp/ndx-review-live-codex.mjs, /private/tmp/ndx-review-live-codex.log, /private/tmp/ndx-review-live-codex-approval.log. Official reference: https://learn.chatgpt.com/docs/config-file/config-reference . Scope approval to this broker; never relax shell approval or sandbox policy. Original broker implementation item 31307b89 exists on main but its implementation/move is already delivered in this stack; this is the newly reproduced approval defect, not a duplicate request to implement a broker. Coordinate with finding 8 so CLI-version probes actually use the requested binary.\n\nOwning PR: https://github.com/en-dash-consulting/n-dx/pull/1008\nReviewed head: a3665ba1f41c622f444cd96d0551ccb2501c5bc0\n\nApproved by Ryan on 2026-11-09 after the nine-PR stack review. This is remediation, not permission to merge, publish, restack, or change unrelated code. Execute only in a dedicated worktree based on the owning PR head; the coordination branch contains capture metadata only. One item per ndx work execution. Use Codex CLI and Codex self-review, never fall back to Claude; keep the affected test gate enabled. The coordinator integrates fixes into the owning PR and performs one bottom-up restack after remediation; individual workers must not restack or force-push the stack."
acceptanceCriteria:
  - "Fresh and resumed Codex Sidecar turns explicitly authorize only the ndx-sidecar broker at the CLI layer while preserving the broker's operator cards."
  - "A real supported CLI smoke test lists only intended MCP tools, reaches ask_choice and a PRD-write card, waits for approval, and performs the write only after approval."
  - "A resumed turn remains read-only, does not request shell escalation, and cannot read broker header values through the child shell; Stop withdraws an outstanding card and the session can continue."
  - "Configured CLI selection from finding 8 is used when reporting tested versions; verify both named versions when available and explicitly report unavailable versions rather than claiming them tested."
  - "Regression tests cover the fresh and resume configuration and existing isolation/refusal cases; scoped tests and required root checks pass; add scoped patch changesets."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
discoveredFrom: {"item":"31307b89-23f6-452a-bd9d-b765e4c23901"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"skipTestGate":false}
tags:
  - "pr-stack-review"
  - "codex-remediation"
  - "finding-2"
  - "pr-1008"
source: "ndx-adversarial-review"
blockedBy:
  - "8db45797-fb8f-47e6-a28f-4df3b247b1c5"
---
