---
id: "97acf4e3-73db-474a-9ee4-8f79e4b88241"
type: "change"
title: "The Sidecar tooling tile names Claude Code as the vendor even when Sidecar sessions run on Codex"
slug: "the-sidecar-tooling-tile-names-claude"
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task 0b3b3a8c (run 266dcbab).\n\npackages/web/src/viewer/views/tooling-summary.ts:65 sets SIDECAR_VENDOR_LABEL = \"Claude Code\", and summarizeSidecarTooling (line ~89) always reports it. Until task 0b3b3a8c, Codex Sidecar sessions were refused, so the label was true. Now a worktree session can run on Codex (the drawer creates sessions on the configured llm.vendor), so with llm.vendor = codex the Tooling panel tells the operator the Sidecar runs on Claude Code while it runs on Codex. Its model line also reads catalog.claude.defaultModel.\n\nReachability: Tooling panel (tooling-panel.ts:121) for any project whose llm.vendor is codex.\n\nOptions:\n- A (recommended): pass the configured vendor into summarizeSidecarTooling and label Claude Code / Codex with that vendor's catalog default model. Small change plus a viewer test.\n- B: label it \"Configured vendor\" without naming one. Cheaper, less useful.\n\n2026-11-24 reconciliation: PR 6 owns current reproduction and accurate Sidecar vendor/model labels. Current source still hardcodes Claude Code; verify current UI before repair. Preserve both criteria, and reflect effective configured/session model pins rather than merely a catalog default when explicit pins exist. Do not reopen completed catalog/picker item 55f8ac69."
acceptanceCriteria:
  - "With llm.vendor codex, the Sidecar tooling line names Codex and the Codex catalog default model (viewer test)"
  - "With llm.vendor claude, it still names Claude Code and the Claude default model"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
priority: "low"
discoveredFrom: {"item":"0b3b3a8c-f6d7-44ec-b289-8c6a2e57205c","run":"266dcbab-7c06-4380-81f6-a48ea9348766"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "codex-hardening"
  - "slot-6"
source: "ndx-adversarial-review"
blockedBy:
  - "f3311428-10bf-4ed0-a4e5-ec6c92722575"
---
