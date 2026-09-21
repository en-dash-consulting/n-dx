---
id: "293eea44-9e4c-4927-ab65-1ea484b9084e"
level: "epic"
title: "Cross-OS Behavioral Parity"
status: "completed"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "macos"
  - "linux"
  - "parity"
  - "reliability"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T19:05:31.624Z"
completedAt: "2026-09-03T18:19:37.851Z"
endedAt: "2026-09-03T18:19:37.851Z"
acceptanceCriteria:
  - "The automated test suite executes on Windows and macOS in CI, not ubuntu alone"
  - "No flow silently claims a security or lifecycle guarantee it does not deliver on a given OS"
  - "Every remaining intentional OS behavioral difference is documented at its call site with the reason it cannot be unified"
  - "Windows-skipped test count is zero, or each remaining skip cites a documented OS limitation rather than convenience"
description: "n-dx targets macOS, Linux, and Windows, but its initialization and regular flows diverge by OS in ways that are unverified and in some cases silently wrong. Distinct from the sibling \"Windows CLI Spawn Hardening\" epic, which is scoped to spawn/quoting mechanics: this epic covers BEHAVIORAL parity — does the same command produce the same effect and the same guarantees on every OS — plus the CI infrastructure needed to prove it.\n\nRoot enabler: the test suite executes on ubuntu-latest ONLY. .github/workflows/ci.yml runs `pnpm -r run test` plus the root suite in the `validate` job (ubuntu); the `smoke-macos` and `smoke-windows` jobs run nothing but `scripts/cli-smoke-parity.mjs collect` — 8 read-only cases (version-text, version-json, unknown-command, typo-suggestion, help-rex, plan-help, status-missing-rex, status-json). No init, work, start, config, or MCP flow is exercised on Windows or macOS by CI, so every Windows-specific branch (win-spawn.js, the quoting twin, child-lifecycle's Windows path) ships without a single test having executed it on Windows.\n\nConfirmed behavioral divergences, all verified against the code:\n- API-key file permissions are silently unenforced on Windows (config.js chmod 0o600), while the help text claims they are set\n- hench's memory admission gate reads accurate available-memory on Linux/macOS but falls back to raw os.freemem() on Windows, biasing throttle decisions\n- `ndx start stop` has its own SIGTERM/SIGKILL path in web.js that bypasses child-lifecycle.js entirely and kills only the server PID, not its tree\n\nThe governing principle: where an OS primitive genuinely has no analog, the DIFFERENCE should be explicit and documented, not silently absorbed into a fallback that makes the code look uniform while behaving differently."
lastModified: "2026-09-03T18:19:37.874Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Align OS-specific behavior in init and regular flows](./align-os-specific-behavior-in-init-and/index.md) | completed |
| [Execute the test suite on Windows and macOS in CI](./execute-the-test-suite-on-windows-and/index.md) | completed |
| [Make the per-package test suites pass on Windows](./make-the-per-package-test-suites-pass/index.md) | completed |
| [Windows CLI Spawn Hardening](./windows-cli-spawn-hardening/index.md) | completed |
