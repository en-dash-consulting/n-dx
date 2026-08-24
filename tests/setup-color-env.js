/**
 * Vitest setupFile — pin color detection to a known state before anything reads it.
 *
 * WHY: `supportsColor()` in packages/core/cli.js and packages/core/help.js checks
 * `FORCE_COLOR` FIRST, ahead of both `NO_COLOR` and `process.stdout.isTTY`. A
 * developer whose shell exports `FORCE_COLOR=3` (it ships with many terminals and
 * tool wrappers, usually alongside `COLORTERM=truecolor`) therefore made the CLI
 * emit ANSI escapes into output that tests compare against plain strings:
 *
 *   expected 'See also: [36mndx plan[39m…' to be 'See also: ndx plan, ndx work'
 *
 * Measured before this file existed: 24 failures across 8 files with FORCE_COLOR=3
 * set, 0 with it unset. GitHub runners do not set FORCE_COLOR, so CI was green and
 * the breakage was invisible there — it hit only humans running the suite locally,
 * and it looked like a real output-contract regression rather than a shell issue.
 *
 * WHY A setupFile RATHER THAN globalSetup: the color result is memoised
 * (`_colorEnabled` in help.js, `colorEnabled` in cli.js), so the environment has
 * to be correct before the FIRST read, not merely before an assertion. setupFiles
 * run inside each worker before that worker loads any test module, which is early
 * enough. They also mutate the worker's own `process.env`, so the CLI child
 * processes the e2e tests spawn inherit the neutralized values — several helpers
 * build `env: { ...process.env, … }`, and fixing the parent covers them.
 *
 * Tests that need color ON override it per-spawn; both `supportsColor()`
 * implementations check FORCE_COLOR before NO_COLOR precisely so that works. See
 * tests/e2e/cli-tty-color.test.js, which asserts ANSI IS emitted under
 * FORCE_COLOR=1 and suppressed under NO_COLOR=1.
 *
 * Do NOT "fix" a colorized-output failure by stripping ANSI in the assertion —
 * that would discard the plain-output contract these tests exist to protect.
 */

// Remove the overrides that would force color on regardless of TTY state.
delete process.env.FORCE_COLOR;
delete process.env.COLORTERM;

// Positively assert no-color rather than relying on `isTTY` being falsy under
// vitest, so the outcome does not depend on how the runner wires up stdio.
process.env.NO_COLOR = "1";
