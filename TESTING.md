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
| rex | Store mutation correctness, tree traversal pipeline, task selection with real PRDStore, legacy multi-file PRD migration into the canonical `prd.md` + `prd.json` pair (and JSON-only → markdown migration on first load), markdown dual-write invariants, cross-vendor authoring regression (smart-add / recommend / reshape / reorganize / prune across Claude and Codex) |
| sourcevision | Analyzer pipeline phases in-process, zone detection with real file inventory |
| hench | Gateway re-export validation, agent loop with mocked LLM responses, self-heal test gate (`runTestGate` succeeds on green, fails fast on red), Codex-batch self-heal fallback |
| web | Cross-zone boundary checks, gateway re-export validation, messaging pipeline integration, cross-vendor pair-programming review (primary→reviewer direction, test-command pass/fail, reviewer-unavailable fallback) |
| llm-client | Adapter resolution, config loading with real filesystem |

Test-file pointers for the scenarios added above:

| Scenario | File |
|----------|------|
| Legacy multi-file PRD migration | `packages/rex/tests/unit/store/prd-migration.test.ts` |
| JSON → `prd.md` migration (one-shot + on-load) | `packages/rex/tests/unit/store/prd-md-migration.test.ts`, `packages/rex/tests/unit/store/file-adapter-markdown-migration.test.ts` |
| Markdown round-trip and dual-write | `packages/rex/tests/unit/store/markdown-roundtrip.test.ts`, `packages/rex/tests/unit/store/prd-write-routing.test.ts` |
| Cross-vendor rex authoring regression | `packages/rex/tests/integration/vendor-regression.test.ts` |
| Self-heal test gate | `packages/hench/tests/integration/test-gate.test.ts` |
| Self-heal Codex-batch fallback | `packages/hench/tests/integration/self-heal-codex-batch.test.ts` |
| Pair-programming cross-vendor review | `tests/integration/pair-programming.test.js` |

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

## Flake Resistance

A test that passes alone but fails inside the full suite is a defect in the
test, not noise to be retried. Two failure families produced every such flake
observed so far; both have a standing rule.

### Family 1 — Foreign responses in HTTP route tests

**Symptom:** a route test receives a status the route group cannot emit (a
`401` from the hench routes, a `200` where the handler only returns `404`).

**Cause:** the response came from a *different* server. Three habits combine to
allow it — `server.close()` was not awaited (it resolves only once sockets
drain, so the ephemeral port can be handed to the next listener while a request
is in flight), the client fetched `localhost` while the server bound the
wildcard address (on dual-stack machines those can be different interfaces),
and a full `pnpm -r test` run has many packages binding ephemeral ports
concurrently.

**Rules:**

- Start servers through `startRouteTestServer` (web) and close them with the
  returned `close()` or `closeRouteTestServer(server)` — **always awaited**.
- Bind and fetch the same literal: `127.0.0.1`, never `localhost`.
- Reset process-wide module state between tests. Vitest shares one worker
  process across test *files*, so module-level singletons leak across files and
  which files share a worker depends on machine load. Route modules that hold
  such state export a reset hook for this (for example
  `resetHenchRouteStateForTests()`).

### Family 3 — Subprocess guardrails too tight for a loaded machine

**Symptom:** an e2e CLI test asserts an exit code and receives `143`
(`128 + SIGTERM`), or a suite reports "test timed out" while the command it
spawned was still doing real work.

**Cause:** the spawn guardrail was sized for an idle machine. A root e2e
command such as `n-dx ci` starts Node and then spawns sourcevision and rex in
turn; while the rest of the monorepo suite saturates every core, that can
exceed a 10s budget. The command is then killed and the assertion compares the
signal exit code against the expected one, which reads as a product failure.

**Rules:**

- Size spawn guardrails for the loaded case, and keep `testTimeout` **above**
  the spawn guardrail so a genuine hang surfaces as a precise spawn timeout
  instead of an opaque test timeout.
- Raising a guardrail is legitimate only when the product path actually runs
  and merely needs wall clock (see Timeout Guardrails). It is never the answer
  to a deterministic assertion failure.
- Assert on exit codes you expect, and treat `143`/`137` as evidence of a
  killed process rather than a product result.

### Family 2 — Wall-clock and render-order assumptions

**Symptom:** a timing ratio or `waitFor` that passes on an idle machine and
fails under load (a linear-scaling check measuring 43× against a 30× ceiling; a
history-navigation test timing out at 3000 ms).

**Cause:** the assertion measured elapsed time, or assumed effects had already
flushed when a DOM query first succeeded.

**Rules:**

Almost every wall-clock assertion in this repo is standing in for a *complexity*
claim — "this must not go quadratic" — not a latency SLA. Three techniques can
carry that claim. Prefer them in this order; each is strictly more load-immune
than the one below it.

- **1. Count work, not time.** Traversal steps, call counts, rendered node
  counts are exact on every machine and cannot flake. `countDOMNodes`' complexity
  test counts `firstChild`/`nextSibling`/`parentNode` accesses. Reach for a clock
  only when the cost being guarded is not countable from inside the call — I/O
  bound work such as the `prd_tree` parse and serialize passes, where what
  regresses is syscall volume.

- **2. When you must use a clock, assert GROWTH between two sizes** rather than
  elapsed milliseconds against a constant. Measure two fixture sizes back-to-back
  in the same process and bound the ratio: ambient load inflates both readings
  together, so the ratio survives a busy machine while a genuine complexity
  regression still trips it. Worked examples, each with its derivation recorded in
  place: `folder-tree-parser.test.ts` (parse, ~11× size step),
  `add-auto-reshape.test.ts` (scoped pass, 4× sibling step),
  `write-path-profile.test.ts` (four phases, 39.6× step).

  An earlier version of this section banned ratios outright, after a
  linear-scaling check measured 43× against a 30× ceiling. That flake was a bound
  picked without measurement, not a fault in the technique — which is what the
  next rule exists to prevent.

- **3. Derive a ratio bound from measurement in BOTH directions, and record the
  numbers.** Clean runs set the floor: take the worst ratio across at least three
  runs and leave roughly 2× above it. Then **inject the regression you claim to
  catch and confirm the gate fails.** Skipping that second half is how a bound
  ends up decorative — `write-path-profile`'s first bound of 6× linear was picked
  from clean baselines alone and let an artificial O(n²) term through at 200.9×;
  only injecting the fault exposed it, and 4× linear fails that same fault at
  188.2×. Take the **minimum** of several timed passes per reading, per phase
  rather than per pass, so one load spike cannot inflate a single side.

- **Absolute budgets are the weakest tool — hang guardrails only — and are scaled
  through `BUDGET_MULTIPLIER`.** Every package that asserts on elapsed time
  declares
  `const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20)`
  and multiplies its budget by it: a 50 ms budget for 2.5 M operations cannot hold
  while the rest of the suite saturates every core, whereas a quadratic rewrite is
  orders of magnitude slower and still fails at 20×. Name such a test for the
  property it guards ("within the scaled linear budget"), never for a millisecond
  figure the assertion no longer uses. If the claim is really about complexity,
  prefer rule 2 and delete the budget rather than scaling it.

- **Never scale a bound whose job is to sit below another number.** Multiplying
  is only safe for a budget that stands alone. Where a bound exists to
  *discriminate* between two outcomes, scaling it lifts it past the thing it was
  distinguishing and the assertion silently starts passing in the failure case.
  `shell.test.ts` asserted `elapsed < 2000 * BUDGET_MULTIPLIER` (40 s) on a
  command whose own lifetime was 3 s: "returned on timeout" and "waited for the
  command" both satisfied it, so the assertion tested nothing. Express such
  bounds as a fraction of the number they must stay under
  (`TIMEOUT_COMMAND_LIFETIME_MS / 4`), so they cannot drift apart.
- **Never click a control whose enabled state depends on a pending effect.**
  Wait for the control to be present *and* enabled, re-querying it each attempt
  — clicking a disabled or replaced element is a silent no-op that then waits
  out the full timeout.
- **Flush effects if you can; retry the action only if you cannot.** Both handle
  the same hazard — a `wheel` dispatched before its listener attaches is lost, and
  a pan applied just before a view-reset effect fires is wiped — but they are not
  equal.
  - *Preferred:* wrap the render and the gesture in `act()` from
    `preact/test-utils`, which flushes Preact's deferred effects synchronously.
    The race is then **closed rather than tolerated**, which buys back an exact
    assertion: `graph-view.test.ts` asserts the transform is exactly
    `translate(0 -40)`.
  - *Fallback:* when no flush point exists, dispatch *inside* the `waitFor` body
    so each poll re-sends the gesture. Only for intents that tolerate repetition:
    a toggle already in its target state, or a cumulative action whose assertion
    accepts any converged value ("a positive multiple of 40").

  Note the cost of the fallback, and why it is the fallback: "a positive multiple
  of 40" no longer distinguishes one correct pan from three, so it cannot catch a
  gesture applied twice. Retrying widens what counts as success; flushing does
  not.
- **Prefer fixing the product when the race is reachable by a user.** The
  focus-history seeding in `graph.ts` was rewritten because a click landing
  before its seeding effect left Back permanently disabled — a real
  slow-first-paint bug that the loaded test machine merely exposed first.

### Integration Test Growth Policy

The integration test count should grow proportionally with cross-package
boundaries. Target: at least one integration test file per architectural
boundary (hench<>rex, web<>rex, web<>sourcevision, viewer<>shared, server<>viewer).

Minimum ratio: integration test files >= 15% of e2e test file count.
This is enforced by `tests/e2e/integration-coverage-policy.test.js`.
