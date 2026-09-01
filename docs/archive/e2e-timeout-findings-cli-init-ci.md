# E2E Timeout Findings: `cli-init` and `cli-ci`

## Summary

Three timeout failures reported during the Codex integration work are most likely not deterministic regressions in the `init` or `ci` command logic.

The reproduced behavior points to a test-runtime problem:

- `tests/e2e/cli-init.test.js` passes when run alone.
- `tests/e2e/cli-ci.test.js` passes when run alone.
- Running them together with default Vitest parallelism causes multiple `cli-init` tests to fail at exactly `5000ms`.
- Running the same two files with `--maxWorkers=1` removes the failures.

The most likely root cause is that several heavy E2E tests are running concurrently, while Vitest still applies its default per-test timeout of 5 seconds.

## What Was Reproduced

### Individual runs

These both passed:

```sh
pnpm exec vitest run tests/e2e/cli-init.test.js
pnpm exec vitest run tests/e2e/cli-ci.test.js
```

Observed behavior:

- `cli-init.test.js`: passed, about 40s total for 20 tests
- `cli-ci.test.js`: passed, about 65s total for 35 tests

### Combined run with default parallelism

This reproduced the timeout failures:

```sh
pnpm exec vitest run tests/e2e/cli-init.test.js tests/e2e/cli-ci.test.js
```

Observed behavior:

- `cli-ci.test.js` still passed
- `cli-init.test.js` failed 5 tests
- every failure was `Error: Test timed out in 5000ms`

Failed cases:

- `persists both providers through config get pathway`
- `re-init on Claude-only project skips Codex when no flags are passed`
- `re-init on Codex-only project skips Claude when no flags are passed`
- `re-init provisions both when both surfaces already exist`
- `explicit --assistants= overrides re-init detection`

### Combined run with one worker

This passed:

```sh
pnpm exec vitest run --maxWorkers=1 tests/e2e/cli-init.test.js tests/e2e/cli-ci.test.js
```

That strongly suggests contention from parallel file execution rather than a broken command path.

## Root Cause

The timeout that is firing is Vitest's default test timeout, not the subprocess timeout inside the helpers.

Relevant files:

- `vitest.config.js`
- `tests/e2e/cli-init.test.js`
- `tests/e2e/e2e-helpers.js`
- `tests/e2e/cli-ci.test.js`

Important details:

- `vitest.config.js` does not set `testTimeout`
- `tests/e2e/cli-init.test.js` runs CLI subprocesses with `timeout: 20000`
- `tests/e2e/e2e-helpers.js` uses `DEFAULT_TIMEOUT = 10000`
- `tests/e2e/cli-ci.test.js` overrides helper calls to `timeout: 30000`

So the subprocesses are allowed 10 to 30 seconds, but Vitest still aborts the test itself after 5 seconds when the test body does too much work under load.

## Why These Tests Are Expensive

### `cli-init` cost

`tests/e2e/cli-init.test.js` is not a cheap contract test. The slowest cases run multiple full `ndx init` calls inside one test.

`packages/core/cli.js` does all of this during `init`:

- runs `sourcevision init`
- runs `rex init`
- runs `hench init`
- sets `llm.vendor`
- provisions assistant integrations

That means a single test can spawn multiple real CLI processes and perform assistant setup more than once.

The slowest failing tests are the re-init compatibility tests because they do:

1. first full init
2. filesystem cleanup or mutation
3. second full init
4. assertions on resulting surfaces

### `cli-ci` cost

`packages/core/ci.js` now includes a real docs build step:

- `pnpm docs:build`

That means `ndx ci` is doing more than `.rex` and `.sourcevision` validation. Even though `cli-ci.test.js` passed in the reproduced runs, it materially increases CPU and I/O load when executed in parallel with `cli-init.test.js`.

## Contributing Factors

### Dual assistant provisioning on init

`packages/core/assistant-integration.js` provisions both vendors by default unless flags disable one of them.

That means a "Codex" init test can still perform Claude setup work unless the test explicitly disables Claude.

### Real Claude binary is present on this machine

The environment used for investigation has both binaries available:

- `claude`
- `codex`

That matters because Claude setup is not entirely inert when the binary exists. `packages/core/claude-integration.js` performs:

- `claude --version`
- `claude mcp add ...` for each MCP server, best-effort

Even if those calls succeed quickly, they add host-dependent latency to `init` tests.

### Several tests exceed 5 seconds even when they eventually pass

In isolated runs, a number of `cli-init` cases were already in the 3 to 4 second range. When the suite runs in parallel with `cli-ci`, those same tests cross Vitest's 5 second threshold.

## Important Non-Finding

The reproduced failures do not currently look like:

- a deterministic bug in `packages/core/cli.js`
- a deterministic bug in `packages/core/assistant-integration.js`
- a deterministic bug in Codex artifact generation

They look like runtime pressure on slow E2E tests.

## Potential Solutions

### Option 1: Raise the E2E test timeout

Possible approaches:

- set a larger global `testTimeout` in `vitest.config.js`
- set a larger timeout only for E2E files
- set explicit timeouts on the slow `cli-init` tests or describes

Pros:

- smallest code change
- directly addresses the failing mechanism
- likely enough to stabilize current failures

Cons:

- does not reduce actual runtime
- can hide future hangs if raised too aggressively

### Option 2: Run heavyweight E2E files serially

Possible approaches:

- run E2E with `--maxWorkers=1`
- configure only selected files to run serially
- split heavyweight E2E tests into a serial CI job

Pros:

- matches reproduced evidence exactly
- low risk to command behavior
- avoids cross-file contention

Cons:

- longer wall-clock test runtime
- treats the symptom more than the per-test cost

### Option 3: Slim down `cli-init.test.js`

Possible approaches:

- convert some artifact assertions to direct integration tests against `setupAssistantIntegrations()`
- reduce repeated full `ndx init` invocations inside one test
- separate backward-compat re-init cases into a slower serial file
- use `--no-claude` in Codex-focused tests when Claude behavior is not under test

Pros:

- reduces real execution cost
- makes failures more targeted
- keeps E2E coverage where it matters most

Cons:

- requires more test restructuring
- needs care to avoid losing meaningful end-to-end coverage

### Option 4: Reduce `ndx ci` cost inside E2E

Possible approaches:

- gate the docs build step behind a flag for focused CI command tests
- move docs build validation into its own dedicated test coverage
- add a fast mode for E2E command validation when docs build is not the subject under test

Pros:

- lowers pressure on the whole suite
- keeps `cli-ci` from being the background load amplifier

Cons:

- introduces product/test-mode branching
- could weaken confidence if the docs build path becomes under-tested

### Option 5: Make assistant setup less host-dependent in tests

Possible approaches:

- stub both `codex` and `claude` binaries in tests that assert init summaries
- avoid real `claude --version` and `claude mcp add` in non-Claude-specific scenarios
- make Claude MCP registration skippable in test environments

Pros:

- reduces machine-specific variance
- makes Codex-focused tests more isolated

Cons:

- may require broader test harness cleanup
- can drift from production behavior if overused

## Recommended Path

The lowest-risk path is:

1. Increase timeout coverage for the slow `cli-init` E2E cases or for E2E generally.
2. Run the heaviest E2E files serially in CI, or cap workers for the root E2E suite.
3. After stability is restored, reduce test cost by restructuring `cli-init.test.js` so fewer cases need two full `ndx init` runs.

If a minimal first fix is needed, the evidence supports Option 1 plus Option 2.

If a more durable fix is preferred, combine Option 1 with Option 3.

## Commands Used During Investigation

```sh
pnpm exec vitest run tests/e2e/cli-init.test.js
pnpm exec vitest run tests/e2e/cli-ci.test.js
pnpm exec vitest run tests/e2e/cli-init.test.js tests/e2e/cli-ci.test.js
pnpm exec vitest run --maxWorkers=1 tests/e2e/cli-init.test.js tests/e2e/cli-ci.test.js
```

## Relevant Files

- `vitest.config.js`
- `tests/e2e/cli-init.test.js`
- `tests/e2e/cli-ci.test.js`
- `tests/e2e/e2e-helpers.js`
- `packages/core/cli.js`
- `packages/core/ci.js`
- `packages/core/config.js`
- `packages/core/assistant-integration.js`
- `packages/core/claude-integration.js`
