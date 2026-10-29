/**
 * Test-only: run agent loops unconfined unless the developer asked otherwise.
 *
 * Production default is the opposite. `ndx work` confines every command the
 * agent runs inside an OS sandbox and refuses an autonomous run when no
 * backend is usable (packages/hench/src/guard/sandbox.ts). Many hosts that run
 * this suite have no usable backend: Linux CI runners ship without bubblewrap,
 * and Seatbelt cannot nest inside an agent harness that is itself sandboxed.
 * Without this the loop tests would exercise the refusal instead of the loop.
 *
 * The confinement itself is tested directly in
 * packages/hench/tests/unit/guard/sandbox.test.ts, which injects its own
 * setting and so is unaffected by this variable; its live suite runs wherever
 * a backend is usable. Set NDX_SANDBOX=on to run the whole suite confined.
 */
if (process.env.NDX_SANDBOX === undefined) {
  process.env.NDX_SANDBOX = "off";
}
