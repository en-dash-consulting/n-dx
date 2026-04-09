/**
 * Orphan child double — simulates a CLI subprocess (e.g. sourcevision analyze)
 * that itself spawns a grandchild.
 *
 * Behaviour:
 *   1. Spawns orphan-grandchild.mjs in the same process group (inherits group
 *      from the parent, which is the group that process-group kill targets).
 *   2. Writes a JSONL record containing both this process's PID and the
 *      grandchild's PID to NDX_TEST_ORPHAN_PID_FILE.
 *   3. Hangs indefinitely, ignoring SIGTERM, so cleanup must escalate to SIGKILL
 *      (or a process-group signal that also reaches the grandchild).
 */

import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const pidFile = process.env.NDX_TEST_ORPHAN_PID_FILE;
const grandchildScript = fileURLToPath(new URL("./orphan-grandchild.mjs", import.meta.url));

// Spawn grandchild without detach — it stays in the same process group as this
// process so that a process-group SIGTERM/SIGKILL reaches it.
const grandchild = spawn(process.execPath, [grandchildScript], {
  stdio: "ignore",
});

if (pidFile) {
  appendFileSync(
    pidFile,
    `${JSON.stringify({ pid: process.pid, grandchildPid: grandchild.pid })}\n`,
    "utf8",
  );
}

// Ignore graceful termination so the tracker must escalate.
process.on("SIGTERM", () => {});

// Keep this process alive until killed.
setInterval(() => {}, 1_000);
