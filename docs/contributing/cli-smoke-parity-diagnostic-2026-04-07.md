# CLI Smoke Parity Diagnostic

Date: 2026-04-07

## Scope

Task: diagnose the current smoke parity suite failure, identify the failing command path, and capture reproducible error context.

## Environment

- Workspace: `/Users/hal/Documents/VSCodeProjects/n-dx-1`
- Platform: `darwin`
- Node: `v22.22.2`
- Package manager: `pnpm`

## Commands Run

```bash
pnpm run validate
pnpm exec vitest run tests/e2e/domain-isolation.test.js
pnpm exec vitest run tests/unit/cli-smoke-parity.test.js
node scripts/cli-smoke-parity.mjs collect --output /tmp/ndx-cli-smoke-local.json
node scripts/cli-smoke-parity.mjs compare \
  --mac /tmp/ndx-cli-smoke-local.json \
  --windows /tmp/ndx-cli-smoke-local.json
```

## Findings

- The parity workflow under CI is defined in `.github/workflows/ci.yml` as:
  - `smoke-macos`: `node scripts/cli-smoke-parity.mjs collect --output ndx-cli-smoke-macos.json`
  - `smoke-windows`: `node scripts/cli-smoke-parity.mjs collect --output ndx-cli-smoke-windows.json`
  - `smoke-parity`: `node scripts/cli-smoke-parity.mjs compare --mac ... --windows ...`
- The likely failing command path in CI is the compare step:

```bash
node scripts/cli-smoke-parity.mjs compare \
  --mac smoke-macos/ndx-cli-smoke-macos.json \
  --windows smoke-windows/ndx-cli-smoke-windows.json
```

- Local reproduction on macOS did **not** fail:
  - `tests/unit/cli-smoke-parity.test.js` passed
  - `scripts/cli-smoke-parity.mjs collect` completed successfully
  - `scripts/cli-smoke-parity.mjs compare` also passed when run against the same collected artifact on both sides

## Concrete Local Artifact Signature

The collected local smoke artifact included these stable case results:

- `version-text`: exit `0`, stdout `0.2.1`
- `version-json`: exit `0`, stdout JSON `{"version":"0.2.1"}`
- `unknown-command`: exit `1`, stderr begins `Error: Unknown command: foobar`
- `typo-suggestion`: exit `1`, stderr `Error: Unknown command: statis` with `Hint: Did you mean 'ndx status'?`
- `help-rex`: exit `0`, stdout begins `Rex — available commands:`
- `plan-help`: exit `0`, stdout begins `ndx plan — analyze codebase and generate PRD proposals`
- `status-missing-rex`: exit `1`, stderr `Error: Missing .rex in <TMPDIR>`
- `status-json`: exit `0`, JSON contract matched expected stable projection

Notable runtime detail from the local `status-json` collection:

```text
(node:47072) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

That warning was emitted on `stderr` while the command still exited `0`.

## Classification

Current classification: `environment-specific behavior`

Reasoning:

- The smoke parity helper logic is green locally.
- The CI workflow compares a macOS artifact against a Windows artifact.
- The current darwin environment does not reproduce a parity failure.
- The most plausible remaining category is platform-specific output drift during smoke collection, most likely in a command whose comparable payload includes human-readable stderr or stdout text.

## Deterministic Reproduction Path

Another engineer can reproduce the same diagnostic flow with:

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/cli-smoke-parity.mjs collect --output ndx-cli-smoke-$(node -p "process.platform").json
```

To reproduce the actual parity decision path used by CI:

1. Run the collect command on macOS.
2. Run the collect command on Windows.
3. Download both JSON artifacts into one machine.
4. Run:

```bash
node scripts/cli-smoke-parity.mjs compare \
  --mac ndx-cli-smoke-macos.json \
  --windows ndx-cli-smoke-windows.json
```

If the job fails, the comparator will raise:

```text
CLI smoke parity failed:
- ...
```

with per-case details such as:

- `<artifact>:<case> exit code ...`
- `<artifact>:<case> stdout missing "..."`
- `<artifact>:<case> stderr missing "..."`
- `<artifact>:<case> JSON projection did not match expected stable contract`
- `parity mismatch for <case>`

## Current Status

- Exact failing case: not reproducible on the available macOS environment
- Exact local command path exercised: `scripts/cli-smoke-parity.mjs collect` and `scripts/cli-smoke-parity.mjs compare`
- Best current root-cause category: Windows-only CLI output drift or other platform-specific smoke artifact divergence

## Follow-up

The next fix should start by obtaining the actual `ndx-cli-smoke-windows.json` artifact from the failing CI run and diffing it against the macOS artifact. Without that artifact, any code fix would be speculative.
