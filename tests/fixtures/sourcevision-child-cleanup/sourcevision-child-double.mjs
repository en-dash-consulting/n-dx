import { appendFileSync } from "node:fs";

const pidFile = process.env.NDX_TEST_SOURCEVISION_PID_FILE;
const mode = process.env.NDX_TEST_SOURCEVISION_MODE ?? "success";

if (pidFile) {
  appendFileSync(
    pidFile,
    `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), mode })}\n`,
    "utf8",
  );
}

if (mode === "failure") {
  setTimeout(() => {
    console.error("sourcevision child double failed");
    process.exit(1);
  }, 50);
} else if (mode === "hang") {
  process.on("SIGTERM", () => {
    // Ignore graceful termination so the parent must escalate to SIGKILL.
  });
  setInterval(() => {}, 1_000);
} else {
  setTimeout(() => {
    process.exit(0);
  }, 50);
}
