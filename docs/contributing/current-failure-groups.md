# Current Failure Groups

This groups the currently reproducible red suites by shared root cause instead of by individual assertion.

## Group 1: Local socket binding is blocked in the current execution environment

- Fix surface: environment setup
- Why this is one group: each failing suite dies before exercising product behavior because the test helper cannot bind a local port. The common failure is `listen EPERM: operation not permitted 0.0.0.0`.
- Affected suites:
  - `packages/sourcevision/tests/e2e/cli-serve.test.ts`
  - `tests/e2e/cli-start.test.js`
  - `tests/e2e/cli-web.test.js`
  - `tests/e2e/mcp-transport.test.js`
- Evidence:
  - `cli-serve.test.ts` fails in `getFreePort()` when `createNetServer().listen(0)` is called.
  - `cli-start.test.js` and `cli-web.test.js` fail in their shared `findAvailablePort()` helper before the CLI server starts.
  - `mcp-transport.test.js` fails when reserving a local port for the MCP HTTP transport.
- Interpretation: this is not currently pointing at a regression in `sourcevision serve`, `n-dx start`, `n-dx web`, or MCP request handling. The runner must allow localhost listeners for these suites to be meaningful.

## Group 2: Production-only architecture gates are being tripped by stale zone configuration

- Fix surface: configuration
- Why this is one group: `tests/e2e/architecture-policy.test.js` is mixing test or infrastructure-style zones into production-only gates, and its exception list has drifted from the generated zone data.
- Affected failures:
  - `no cycles exist among production zones in the zone-level import graph`
  - `COHESION_EXCEPTIONS contains no stale entries`
- Evidence:
  - The cycle hub is `server-route-guardrails-tests`, which is named like a test zone but is being treated as production by the gate.
  - The same run also flags `repo-ops-shell` and `web-build-tooling`, which are infrastructure-style zones that should not participate in production cohesion enforcement.
  - The stale exception assertion lists zones that either no longer exist or now meet threshold: `cli-binary-shims`, `project-status-hooks`, `rex-chunked-review`, `rex-package-infrastructure`, `rex-task-verification`.
- Interpretation: the first fix should be in zone metadata and policy configuration, not in application logic. Restore accurate zone typing/exemptions before treating every architecture-policy failure as a code refactor.

## Group 3: Several real production zones are structurally too fragmented

- Fix surface: application architecture
- Why this is one group: even after separating the configuration drift above, the remaining red architecture findings point to small, weakly cohesive production zones that have grown into unstable boundaries.
- Affected failure:
  - `all production zones meet minimum cohesion threshold (0.5)`
- Evidence:
  - Web/viewer-side zones below threshold: `dom-performance-monitor`, `memory-pressure-monitor`, `refresh-rate-throttle`, `tick-polling-scheduler`, `viewer-polling-lifecycle`, `web-viewer-data-loader`.
  - Rex-side zones below threshold: `rex-prd-fix-command`, `rex-structure-health-monitor`.
- Interpretation: this is the production-code bucket. The likely fixes are merging micro-zones, extracting neutral shared modules, or reshaping dependency direction so these areas stop behaving like isolated fragments.

## Summary

- Environment setup issue: local server tests cannot bind ports in the current runner.
- Configuration issue: zone metadata and cohesion exceptions are stale relative to the generated `.sourcevision` model.
- Application architecture issue: a smaller set of real production zones remains below the cohesion bar and needs structural cleanup.

## Timeout Guardrail Triage

The current timeout-only test edits fall into two different buckets. Keep them separate.

### Legitimate timeout guardrails

These are acceptable because they add an explicit upper bound to suites that can
otherwise hang while waiting for subprocess shutdown, async polling, or startup
readiness. They do **not** address the currently failing assertions by themselves.

- `packages/sourcevision/tests/e2e/cli-analyze.test.ts`
- `packages/rex/tests/e2e/cli-import.test.ts`
- `packages/rex/tests/e2e/cli-prune.test.ts`
- `packages/rex/tests/e2e/cli-recommend.test.ts`
- `packages/rex/tests/e2e/cli-workflow.test.ts`

Why these belong in the guardrail bucket:

- They are subprocess-heavy e2e suites where multiple CLI/bootstrap paths are repeated across one file.
- The timeout change is additive only: the assertions, fixtures, and product code under test stay the same.
- The repo already treats this pattern as valid for required startup coverage, for example `tests/e2e/cli-dev.test.js`.
- `tests/e2e/vitest-timeout-failure.test.js` exists specifically to verify that a timed-out test still fails normally and still runs teardown.

#### Strategy by suite

Use the following scope decisions when touching the current at-risk suites:

| Suite | Strategy | Reason |
| --- | --- | --- |
| `packages/sourcevision/tests/e2e/cli-analyze.test.ts` | Per-suite | Multiple scenarios repeat the same CLI/bootstrap path; each `execFileSync` call is already individually bounded, so the Vitest timeout is only the outer hang cap. |
| `packages/rex/tests/e2e/cli-import.test.ts` | Per-suite | Several subprocess-backed scenarios share the same CLI path; keep one outer suite cap instead of duplicating the same Vitest timeout on each case. |
| `packages/rex/tests/e2e/cli-prune.test.ts` | Per-suite | The suite chains multiple CLI operations per case; the suite timeout is an aggregate guardrail while command-level timeouts still do the immediate fail-fast work. |
| `packages/rex/tests/e2e/cli-recommend.test.ts` | Per-suite | Same rationale as other subprocess-heavy rex e2e coverage: outer suite cap, command-level inner bounds. |
| `packages/rex/tests/e2e/cli-workflow.test.ts` | Per-suite | This file exercises a long multi-command workflow; keep the timeout at the suite level so the assertions remain unchanged across all steps. |
| `packages/rex/tests/e2e/cli-sync.test.ts` | Exclude from extra wrappers | This suite already runs only fast error/help paths through `execFileSync(..., { timeout: 10000 })`; do not add more timeout layers unless sync starts a long-lived adapter path. |
| `tests/e2e/cli-dev.test.js` | Keep existing suite timeout only | This required startup suite already has a 30 s suite timeout plus helper-level `execFileSync(..., { timeout: 10000 })`; keep the explicit cap because it is the only guard for this required coverage. |
| `packages/web/tests/integration/background-suspension-recovery.test.ts` | Exclude from extra wrappers | The suite advances fake timers explicitly and is already deterministically bounded by the test code itself. |
| `packages/web/tests/integration/memory-aware-polling-suspension.test.ts` | Exclude from extra wrappers | Fake-timer driven throughout; add real timeout wrappers only if the suite later introduces real async waits that can block CI. |
| `packages/web/tests/integration/pr-markdown-tab-parity.test.ts` | Exclude from extra wrappers | Uses bounded `waitFor` helpers with fixed deadlines for each UI transition. |
| `packages/web/tests/integration/request-dedup.test.ts` | Exclude from extra wrappers | Progress is driven by fake timers and controlled promises, so hangs are already localized and deterministic. |
| `packages/web/tests/integration/token-usage-route-regression.test.ts` | Exclude from extra wrappers | Uses bounded route-render `waitFor` checks rather than open-ended background work. |
| `packages/web/tests/integration/ws-health-integration.test.ts` | Exclude from extra wrappers | Real sockets are used, but the risky handshake/wait paths already have fixed 3s/50ms bounds. |
| `tests/integration/scheduler-startup.test.js` | Exclude from extra wrappers | The suite uses short fixed waits against a local interval handle and is already deterministically capped without another Vitest timeout layer. |
| `packages/web/tests/unit/server/websocket.test.ts` | Exclude from extra wrappers | Unit-scope socket coverage is already bounded by explicit handshake/read timeouts inside the helper functions. |
| `packages/web/tests/unit/server/port.test.ts` | Exclude from extra wrappers | Retry behavior is exercised with short `retryDelayMs` values and deterministic release timers; it already fails fast. |
| `packages/web/tests/unit/server/shutdown-handler.test.ts` | Exclude from extra wrappers | Shutdown completion waits are already expressed with `vi.waitFor(..., { timeout: 5000 })` and fake-timer driven timeout-path tests. |

In short: keep suite-level guardrails for the subprocess-heavy CLI files, and
do not stack more timeout wrappers onto suites that already control time
directly with command timeouts, fake timers, or helper deadlines.

### Observable hang-risk inventory

This review covered the current suites with observable hang-risk patterns across
unit, integration, and e2e tiers. The goal is to keep the identified set tied
to concrete behavior in the test code rather than to intuition.

| Suite | Observable pattern | Current bound | Disposition |
| --- | --- | --- | --- |
| `tests/e2e/cli-dev.test.js` | CLI startup via shared `execFileSync` helper | Helper timeout 10 s + suite timeout 30 s | Keep existing suite cap; required startup coverage. |
| `packages/sourcevision/tests/e2e/cli-analyze.test.ts` | Repeated CLI subprocess execution | Per-command timeout 30 s + suite timeout | Valid outer guardrail candidate. |
| `packages/sourcevision/tests/e2e/cli-serve.test.ts` | Port reservation, spawned server, readiness polling | Analyze timeout 30 s + test timeout 30 s + polling deadline | Externally coordinated; current red is environment (`listen EPERM`), not timeout tuning. |
| `tests/e2e/cli-start.test.js` | Port reservation, background server lifecycle, PID cleanup, fixed sleeps | Per-command timeout 10 s + suite timeout 120 s | Externally coordinated; fix environment/startup issues, not timeout policy. |
| `tests/e2e/cli-web.test.js` | Port reservation, background server lifecycle, PID cleanup | Per-command timeout 10 s + suite timeout 120 s | Externally coordinated; fix environment/startup issues, not timeout policy. |
| `tests/e2e/mcp-transport.test.js` | Spawned web server, health polling loop, HTTP session lifecycle, shutdown wait | `waitForServer` 8 s + shutdown fallback 3 s + suite timeout 120 s | Externally coordinated; already bounded, but still a real hang-risk suite. |
| `packages/rex/tests/e2e/cli-import.test.ts` | Repeated CLI subprocess execution | Per-command timeout 15 s + suite timeout | Valid outer guardrail candidate. |
| `packages/rex/tests/e2e/cli-prune.test.ts` | Multi-command CLI workflow per test | Per-command timeout 10 s + suite timeout | Valid outer guardrail candidate. |
| `packages/rex/tests/e2e/cli-recommend.test.ts` | CLI subprocesses plus file setup/reads | Per-command timeout 15 s + suite timeout | Valid outer guardrail candidate. |
| `packages/rex/tests/e2e/cli-workflow.test.ts` | Long chained CLI workflow | Per-command timeout 10 s + suite timeout | Valid outer guardrail candidate. |
| `packages/rex/tests/e2e/cli-sync.test.ts` | CLI subprocesses only on fast help/error paths | Per-command timeout 10 s + suite timeout | Not a current hang-risk candidate beyond existing command timeout. |
| `tests/integration/scheduler-startup.test.js` | Real `setInterval` lifecycle and cleanup waits | Fixed waits (50-180 ms) + suite timeout 120 s | Long-running startup coverage, but already deterministically bounded. |
| `packages/web/tests/integration/background-suspension-recovery.test.ts` | Polling lifecycle with fake timers | Fake timers + suite timeout | No extra wrapper needed. |
| `packages/web/tests/integration/memory-aware-polling-suspension.test.ts` | Polling lifecycle with fake timers | Fake timers + suite timeout | No extra wrapper needed. |
| `packages/web/tests/integration/pr-markdown-tab-parity.test.ts` | Repeated bounded `waitFor` UI polling | `waitFor` deadline | No extra wrapper needed. |
| `packages/web/tests/integration/request-dedup.test.ts` | Controlled promises plus fake timers | Fake timers | No extra wrapper needed. |
| `packages/web/tests/integration/token-usage-route-regression.test.ts` | Manual `while`-polling helper | `waitFor` deadline 8 s | No extra wrapper needed. |
| `packages/web/tests/integration/ws-health-integration.test.ts` | Real socket handshake and heartbeat waits | Fixed 3 s / 50 ms helper bounds | No extra wrapper needed. |
| `packages/web/tests/unit/server/websocket.test.ts` | Raw socket handshake and frame-read loops | Helper-level handshake/read timeouts | Unit suite reviewed; already bounded. |
| `packages/web/tests/unit/server/port.test.ts` | Port bind retries and delayed release | Short retry delays and timed release | Unit suite reviewed; already bounded. |
| `packages/web/tests/unit/server/shutdown-handler.test.ts` | Graceful shutdown lifecycle waits | `vi.waitFor(..., { timeout: 5000 })` + fake timers | Unit suite reviewed; already bounded. |

### Not a substitute for red-to-green fixes

The currently failing root suites below still need real environment, configuration,
or production-side fixes. Adding a larger timeout to them does not solve the defect.

- `packages/sourcevision/tests/e2e/cli-serve.test.ts`
- `tests/e2e/cli-start.test.js`
- `tests/e2e/cli-web.test.js`
- `tests/e2e/mcp-transport.test.js`
- `tests/e2e/architecture-policy.test.js`

Why these are **not** timeout problems:

- `cli-serve`, `cli-start`, `cli-web`, and `mcp-transport` fail at local port reservation with `listen EPERM` before the target server behavior is exercised. That is an environment capability problem, not a slow-test problem.
- `architecture-policy.test.js` is failing on stale zone classification and cohesion policy drift. That is configuration and structural cleanup work, not runner timing.
- Raising or adding test timeouts in these suites would only make the same failures happen later, which would hide the actual remediation path.

### Decision rule

When a failure already has a concrete non-timeout cause, fix that cause first.
Only add a timeout when the goal is to cap an otherwise healthy suite's hang
budget, never to make an existing failing test pass.
