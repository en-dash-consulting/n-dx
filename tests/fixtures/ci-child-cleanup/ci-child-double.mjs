/**
 * Fixture: fake CI subprocess double used by cli-ci-child-cleanup.test.js.
 *
 * When any node spawn inside ndx ci is redirected here, this script:
 *   1. Records its PID to the shared JSONL file so the test can track it.
 *   2. Behaves according to NDX_TEST_CI_MODE:
 *      - "success" (default) — exits 0 after a short delay
 *      - "hang"              — blocks indefinitely (ignores SIGTERM so the
 *                             parent must escalate to SIGKILL)
 */

import { appendFileSync } from "node:fs";

const pidFile = process.env.NDX_TEST_CI_PID_FILE;
const mode = process.env.NDX_TEST_CI_MODE ?? "success";

if (pidFile) {
  appendFileSync(
    pidFile,
    `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), mode })}\n`,
    "utf8",
  );
}

if (mode === "hang") {
  process.on("SIGTERM", () => {
    // Deliberately ignore graceful termination so parent must escalate to SIGKILL.
  });
  setInterval(() => {}, 1_000);
} else {
  // "success" — exit quickly with a minimal JSON body so runCapture parses fine.
  setTimeout(() => {
    process.stdout.write(JSON.stringify({ ok: true }));
    process.exit(0);
  }, 50);
}
