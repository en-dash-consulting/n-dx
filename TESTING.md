# Testing Conventions

## Test Directory Structure

Every package must maintain three test tiers:

```
packages/<name>/tests/
  unit/           # Isolated function/class tests (no I/O, no network)
  integration/    # In-process contract tests (real stores, gateways, pipelines)
  e2e/            # Full CLI/process tests (spawn commands, validate output)
  fixtures/       # Shared test data
```

## Integration Test Tier

The integration tier bridges the gap between unit tests (isolated) and e2e tests
(full CLI spawn). Each package must have a `tests/integration/` directory with
tests that exercise in-process contract scenarios.

### Required Coverage

| Package | Required integration scenarios |
|---------|-------------------------------|
| rex | Store mutation correctness, tree traversal pipeline, task selection with real PRDStore |
| sourcevision | Analyzer pipeline phases in-process, zone detection with real file inventory |
| hench | Gateway re-export validation, agent loop with mocked LLM responses |
| web | Cross-zone boundary checks, gateway re-export validation, messaging pipeline integration |
| llm-client | Adapter resolution, config loading with real filesystem |

### Gateway Admission Criterion

Any new gateway module (rex-gateway, domain-gateway, llm-gateway, external.ts)
**must** have a corresponding integration test added to `tests/integration/`
within the same PR that introduces the gateway. This prevents gateways from
existing with zero integration-tier coverage.

Integration tests for gateways should verify:

1. **Re-export existence** -- every symbol re-exported by the gateway is
   callable/constructible (catches API drift from upstream)
2. **Contract correctness** -- at least one end-to-end scenario through the
   gateway (e.g., `resolveStore()` -> `findNextTask()` -> `updateStatus()`)
3. **Type alignment** -- type re-exports match the upstream package's public API

### Co-evolution Rule: Seam Registry and Gateway Table

CLAUDE.md maintains two manually-maintained governance tables documenting
cross-zone seams — the **injection seam registry** and the **gateway table**.
These tables have no automated exhaustiveness check (see the governance list
completeness audit in CLAUDE.md), so correspondence with integration tests can
only be maintained through discipline.

**Rule:** Every new row added to either table in CLAUDE.md requires a
corresponding integration test in the same PR. Never widen the gap between table
entries and tests.

For **injection seam entries** the test must verify:

1. **Runtime callback invocation** — the target module calls each injected
   function with the expected calling convention. TypeScript structural checks
   verify signature compatibility but cannot verify that the callback is actually
   invoked at runtime.
2. **Optional-callback safety** — the target module does not throw when optional
   callbacks are omitted from the options object.

See `packages/web/tests/integration/seam-register-scheduler.test.ts` as the
reference implementation for injection seam tests.

For **gateway entries** follow the Gateway Admission Criterion above.

Violating this rule silently decouples the documented architecture from
integration coverage. When you encounter a table entry without a corresponding
test, add the test before adding further entries — do not widen the gap.

### Test File Placement Convention

A test file whose primary production import target is classified in zone X must
reside under a directory corresponding to X, not a sibling zone's directory.

Examples:
- Tests for `src/shared/node-culler.ts` belong in `tests/unit/shared/`, not `tests/unit/viewer/`
- Tests for `src/server/routes/` belong in `tests/unit/server/`, not `tests/unit/viewer/`
- Tests for `src/viewer/messaging/` belong in `tests/unit/viewer/` (messaging is a viewer sub-zone)

### Web-Shared Admission Criteria

A file belongs in `web-shared` (`packages/web/src/shared/`) only if it meets
**all three** of the following criteria:

1. **Zero framework imports** — no Preact, no Express, no jsdom. The file must
   be framework-agnostic and runnable in any JavaScript environment.
2. **Multi-layer consumption** — the file is consumed by at least two distinct
   layers above it (e.g., both `web-server` and `web-viewer`, or both
   `web-viewer` and `viewer-message-pipeline`).
3. **Cohesive abstraction** — the file exposes a single, well-defined
   abstraction (e.g., data-file constants, node-culler utility), not a grab-bag
   of unrelated helpers.

Without these criteria, `web-shared` functions as a residual zone — the place
files go when they don't fit anywhere else — which degrades cohesion and invites
cycle-breaking relocations that don't improve the architecture.

**Decision tree for new shared files:**

- Does it import `preact`, `express`, or other framework? → **Not shared.** Place
  in the appropriate framework-specific zone.
- Is it only used by one layer? → **Not shared.** Place it in the consuming zone.
- Is it a collection of unrelated helpers? → **Split it** into cohesive modules
  first, then evaluate each independently.

### Required Tests

Certain test files are **required** (not skippable) because they are the sole
coverage point for critical startup paths. Removing or skipping these tests
would create silent coverage gaps.

| Test file | Covers | Why required |
|-----------|--------|-------------|
| `tests/e2e/cli-dev.test.js` | `ndx dev` command startup | Single point of failure for dev-mode coverage |
| `tests/integration/scheduler-startup.test.js` | Usage cleanup scheduler boot | Single point of failure for server scheduler wiring |

These tests must remain in the test suite. If refactoring changes their targets,
update the tests — do not delete them.

Required test files must contain the annotation `REQUIRED TEST` (case-insensitive) in
a comment near the top of the file. This annotation is machine-verified by
`tests/e2e/architecture-policy.test.js` to prevent silent removal of required test
coverage.

## Timeout Guardrails

Timeouts are allowed only as **guardrails against hangs**, not as a way to turn an
existing red suite green.

Use a test-level timeout when all of the following are true:

1. The test exercises a startup, integration, or subprocess path that is expected
   to finish but could hang indefinitely if cleanup or readiness logic regresses.
2. The timeout does **not** change the assertion surface. The same behavior should
   still pass when the system is healthy.
3. The timeout causes the runner to fail fast with a deterministic error instead
   of waiting for the global default timeout.

Do **not** respond to these failures by increasing or adding test timeouts:

- Deterministic assertion failures
- Environment failures that occur before the product path runs (for example,
  socket bind errors such as `listen EPERM`)
- Configuration or architecture-policy failures
- Regressions that require production or configuration changes

If a suite is already failing for one of the reasons above, the fix belongs in
production code, environment setup, or policy/configuration. Timeout edits must
never be used to mask that work.

When choosing the timeout scope for a hang-risk suite, prefer the narrowest
bound that matches the failure mode:

- Use a suite-level Vitest timeout for multi-scenario startup or CLI suites
  where the same subprocess/bootstrap path is repeated across many tests and the
  goal is only to cap the suite's total hang budget.
- Use a per-test timeout when a single test owns the risky wait path and the
  rest of the file is already cheap and deterministic.
- Do not add either wrapper when the suite already has deterministic bounds,
  such as `execFileSync(..., { timeout })`, fake-timer driven progression, or
  helper polling with a fixed deadline. Those suites are already fail-fast and
  should not accumulate redundant timeout layers without a new hang mode.

### Integration Test Growth Policy

The integration test count should grow proportionally with cross-package
boundaries. Target: at least one integration test file per architectural
boundary (hench<>rex, web<>rex, web<>sourcevision, viewer<>shared, server<>viewer).

Minimum ratio: integration test files >= 15% of e2e test file count.
This is enforced by `tests/e2e/integration-coverage-policy.test.js`.
