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
import { spawn } from "node:child_process";

const pidFile = process.env.NDX_TEST_CI_PID_FILE;
const mode = process.env.NDX_TEST_CI_MODE ?? "success";

const kind = process.argv[2] === "docs:build" ? "docs-build" : "ci-tool";

function recordPid(record) {
  if (!pidFile) return;

  appendFileSync(
    pidFile,
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
}

recordPid({ pid: process.pid, argv: process.argv.slice(2), mode, kind });

if (mode === "hang") {
  if (kind === "docs-build") {
    // The Windows docs-build path is shell-backed (`cmd.exe` → node), so this
    // makes the real CI shutdown test prove taskkill /T reaches below that
    // tracked shell child as well as its direct Node process.
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    recordPid({
      pid: grandchild.pid,
      argv: ["docs-build-grandchild"],
      mode,
      kind: "docs-build-grandchild",
      parentPid: process.pid,
    });
  }

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
