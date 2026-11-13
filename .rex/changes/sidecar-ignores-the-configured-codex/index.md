---
id: "8db45797-fb8f-47e6-a28f-4df3b247b1c5"
type: "change"
title: "Sidecar ignores the configured Codex CLI binary path"
slug: "sidecar-ignores-the-configured-codex"
intent: "Finding 8, PR #1008; packages/web/src/server/sidecar/session-registry.ts:252-255 and llm-client/vendor-session.ts. sidecarSessionConnect returns llmConfig containing llm.codex.cli_path, but no binary; startVendorSession spawns opts.binary ?? driver.binary, so actualBinary remains codex from PATH. A configured /tmp/operator-chosen-codex was ignored in a recording-spawn reproduction. The PR's instructions for selecting the bundled alpha versus 0.166 therefore do not select the requested binary. Resolve and pass the effective vendor CLI path through the existing trusted-config/discovery boundary; preserve local overrides and repo trust. Check the shared Claude path behavior too, but keep remediation focused on the same resolution path rather than introducing another resolver. Evidence: /private/tmp/ndx-review-repro.mjs and .log.\n\nOwning PR: https://github.com/en-dash-consulting/n-dx/pull/1008\nReviewed head: a3665ba1f41c622f444cd96d0551ccb2501c5bc0\n\nApproved by Ryan on 2026-11-09 after the nine-PR stack review. This is remediation, not permission to merge, publish, restack, or change unrelated code. Execute only in a dedicated worktree based on the owning PR head; the coordination branch contains capture metadata only. One item per ndx work execution. Use Codex CLI and Codex self-review, never fall back to Claude; keep the affected test gate enabled. The coordinator integrates fixes into the owning PR and performs one bottom-up restack after remediation; individual workers must not restack or force-push the stack."
acceptanceCriteria:
  - "The Sidecar's actual fresh and resumed spawn uses the effective llm.codex.cli_path when configured, even when a different codex exists on PATH."
  - "Recording-spawn or fake-binary tests assert the binary invoked, not merely that llmConfig contains a path; missing configured binaries produce an actionable failure."
  - "Resolution follows existing trust and local-config precedence rules and preserves normal PATH/discovery behavior when no explicit path exists."
  - "The selected version can be verified by the live broker smoke test for finding 2; scoped tests and required root checks pass; add scoped patch changesets."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "medium"
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"skipTestGate":false}
tags:
  - "pr-stack-review"
  - "codex-remediation"
  - "finding-8"
  - "pr-1008"
source: "ndx-adversarial-review"
---
