/**
 * Fixture: stand-in for `pnpm docs:build` in cli-ci-child-cleanup.test.js.
 *
 * `ndx ci` runs its documentation phase — which ends in a tracked
 * `pnpm docs:build` spawn — *before* the analysis phase that spawns the
 * sourcevision and rex CLIs this suite actually tracks. The test polls for the
 * first recorded child PID with a 3s deadline, so every millisecond the docs
 * phase spends is deducted from that window. Measured on an idle machine,
 * time-to-first-PID was 539ms, of which ~490ms was pnpm booting in a temp
 * directory with no package.json. Under a full `pnpm test` run, where many pnpm
 * processes contend for the store, that single spawn can exceed the whole
 * window — which is how this suite came to fail with "Timed out waiting for CI
 * child PID record" on unchanged code.
 *
 * Substituting this stub takes pnpm's startup cost out of the measurement while
 * leaving the spawn itself in place: it still goes through `spawnTracked`, so the
 * tracker surface under test is unchanged. Time-to-first-PID drops to ~50ms.
 *
 * Deliberately does NOT write to NDX_TEST_CI_PID_FILE. The test's
 * `readFirstPidRecord` returns the *first* record, and it must be the analysis
 * child — recording this one would make the suite track the docs process instead
 * and, in "hang" mode, would stall the pipeline before it ever reached the step
 * being exercised.
 *
 * Exits 0 so ci.js reports "✓ docs build", which is also the truthful outcome to
 * model: a docs-build failure is recorded but does not gate the pipeline.
 */

process.exit(0);
