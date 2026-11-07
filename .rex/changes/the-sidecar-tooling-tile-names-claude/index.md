---
id: "97acf4e3-73db-474a-9ee4-8f79e4b88241"
type: "change"
title: "The Sidecar tooling tile names Claude Code as the vendor even when Sidecar sessions run on Codex"
slug: "the-sidecar-tooling-tile-names-claude"
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task 0b3b3a8c (run 266dcbab).\n\npackages/web/src/viewer/views/tooling-summary.ts:65 sets SIDECAR_VENDOR_LABEL = \"Claude Code\", and summarizeSidecarTooling (line ~89) always reports it. Until task 0b3b3a8c, Codex Sidecar sessions were refused, so the label was true. Now a worktree session can run on Codex (the drawer creates sessions on the configured llm.vendor), so with llm.vendor = codex the Tooling panel tells the operator the Sidecar runs on Claude Code while it runs on Codex. Its model line also reads catalog.claude.defaultModel.\n\nReachability: Tooling panel (tooling-panel.ts:121) for any project whose llm.vendor is codex.\n\nOptions:\n- A (recommended): pass the configured vendor into summarizeSidecarTooling and label Claude Code / Codex with that vendor's catalog default model. Small change plus a viewer test.\n- B: label it \"Configured vendor\" without naming one. Cheaper, less useful."
acceptanceCriteria:
  - "With llm.vendor codex, the Sidecar tooling line names Codex and the Codex catalog default model (viewer test)"
  - "With llm.vendor claude, it still names Claude Code and the Claude default model"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"0b3b3a8c-f6d7-44ec-b289-8c6a2e57205c","run":"266dcbab-7c06-4380-81f6-a48ea9348766"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
