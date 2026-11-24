---
id: "4052976b-6d5a-41f4-b987-c72dca886e01"
type: "change"
title: "Correct Codex model-pin test assertions for Windows command wrapping"
slug: "correct-codex-model-pin-test"
summary: "Keep the model-pin regression checks reliable on Windows as well as macOS and Linux. The checks must still reject a changed or missing model pin."
intent: "User explicitly approved these two narrow portability fixes on 2026-11-16 after draft PR2 #1058 was published. Include this corrective follow-up in PR2 through actual checkout-local ndx work. PR1 CI43562733953 showed packages/hench/tests/integration/codex-token-accounting.test.ts inspecting wrapper args instead of the Codex command and packages/llm-client/tests/unit/codex-output-validation.test.ts reading '/d' instead of gpt-5.4. Correct only these test assertions and minimal adjacent test helpers/meaningful regression coverage needed to exercise POSIX and cmd.exe-wrapped argv, without changing production spawn semantics or weakening the literal pin and single-attempt rejection guarantees. The original pricing task/run remains completed and is not rerun. Do not fix credential-store-writers or any unrelated CI issue. Preserve existing dirty work, old damaged clone and all unrelated sessions. No merge/auto-merge or PR3 execution."
acceptanceCriteria:
  - "The hench Codex rejection regression asserts the literal gpt-5.4 pin from the effective Codex command on POSIX and cmd.exe-wrapped Windows spawns while retaining its single-attempt rejection and migration-guidance assertions."
  - "The llm-client Codex literal-pin regression asserts the exact gpt-5.4 model value on POSIX and cmd.exe-wrapped Windows spawns; wrong or missing model values still fail the check."
  - "Meaningful scoped validation demonstrates both argv representations without requiring a local Windows host, and distinguishes simulated Windows evidence from actual Windows CI. No production behavior, credential-store tests, catalog/defaults, pricing logic or unrelated tests are changed."
  - "Required cli-dev and scheduler-startup checks and mandatory affected gate pass; fresh mandatory Astra Codex self-review, scoped patch changesets and an atomic test/PRD completion commit with bare N-DX-Item trailer are retained."
touches:
  - "405c9fcf-2258-472f-8eb7-30d5b7ae0b8a"
priority: "high"
discoveredFrom: {"item":"8d9405d1-a805-4254-b91f-36ed91469452","run":"569fdfab-4c1e-46c8-8a14-c795eb47285a"}
run: {"tier":"standard","models":{"codex":"gpt-6.1-sol"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"Bounded two-assertion test portability correction with test-only helpers and clear mocked argv oracles: standard Sol execution is adequate; mandatory fresh heavy Astra self-review checks preservation of literal-pin and rejection guarantees. Coordination Sol medium; effort advisory only. Work only in approved /private/tmp/ndx-parity-pr2, never original or damaged old clone. Actual checkout-local ndx work owns claim/log/completion/atomic commit. Preserve sandbox workspace-write/network-disabled and mandatory gates, external disposable fixture homes, Node22.22.2/pnpm10.33.0 and VITEST_MAX_WORKERS=2. The exact-clone outer NDX_SANDBOX=off exception remains authorized; never bypass Codex confinement. Required root startup tests; scoped affected validation; @n-dx/hench and @n-dx/llm-client patch changesets if affected. Write .hench-commit-msg.txt sentinel if confined staging is denied; never git add -A or git add .; Hench finalizes. No global config or credential changes, no credential-lock fix, no source implementation beyond test portability scope, no merge/auto-merge, no PR3. Existing test helper packages/hench/tests/helpers/scripted-claude-cli.ts handles Windows command decoding; inspect established conventions before choosing the smallest fix. Historical PR2 operational artifacts: /Users/ryankeith/.codex/visualizations/2026/11/16/01a1e509-e563-7b13-8664-de7809a902e8/codex-parity-pr2-handoff.txt (the two portability fixes were approved after that snapshot)."}
tags:
  - "codex-parity"
  - "approved"
  - "codex-parity-pr-2"
  - "windows-portability-followup"
source: "ndx-capture"
blockedBy:
  - "0c727192-938b-46d8-b068-2e7022139750"
---
