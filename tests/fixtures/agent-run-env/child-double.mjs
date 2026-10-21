/**
 * Stands in for a rex, hench or sourcevision CLI: appends the tool, its
 * arguments and the env vars under test to NDX_TEST_CHILD_ENV_LOG, prints an
 * empty JSON list for --format=json, and exits 0.
 */
import { appendFileSync } from "node:fs";

const [tool, ...args] = process.argv.slice(2);
const record = {
  tool,
  args,
  NDX_LEGACY_NOTICE: process.env.NDX_LEGACY_NOTICE ?? null,
  NDX_AGENT_RUN: process.env.NDX_AGENT_RUN ?? null,
};
appendFileSync(process.env.NDX_TEST_CHILD_ENV_LOG, `${JSON.stringify(record)}\n`, "utf8");

if (args.includes("--format=json")) console.log("[]");
