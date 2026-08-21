/**
 * Vitest setupFile — hide the ambient Claude Code session from the test suite.
 *
 * WHY: `hench record` reads token usage from the current Claude Code session's
 * transcript, discovered through `CLAUDE_CODE_SESSION_ID`. Claude Code exports
 * that variable to every tool it runs — including `pnpm test`. So a suite run
 * from inside a Claude Code session picked up a real, ever-growing transcript,
 * and any test touching the record path asserted against live numbers:
 *
 *   expected 'claude-opus-5' to be 'claude-sonnet-4-6'
 *
 * The model came from the ambient session rather than from the config the test
 * had just written. Token counts would have been worse — they change between
 * runs, so the failure would have looked like a flake rather than an environment
 * leak. CI never sets the variable, so CI stayed green and only humans running
 * the suite inside Claude Code (or an agent doing the same) saw it.
 *
 * This is the same shape as tests/setup-color-env.js, for the same reason: an
 * ambient variable the production code is right to consult, and which a test must
 * therefore control rather than inherit. Tests that want the transcript path
 * exercise it explicitly with `--transcript=<fixture>`, which is deterministic;
 * tests that want the no-session path now get it reliably.
 *
 * WHY A setupFile RATHER THAN globalSetup: setupFiles run inside each worker
 * before that worker loads any test module, so the variable is gone before any
 * code can read it. globalSetup runs in a different process and would not affect
 * the workers' environment.
 *
 * `CLAUDE_CONFIG_DIR` is cleared alongside it: it relocates the transcript tree,
 * so leaving it set would point a fixture-driven lookup at a real one.
 */

delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CLAUDE_CONFIG_DIR;
