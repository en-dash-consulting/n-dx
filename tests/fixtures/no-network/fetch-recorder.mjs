/**
 * Loaded through NODE_OPTIONS=--import. When NDX_TEST_FETCH_LOG is set,
 * replaces `fetch` in this process (and, through NODE_OPTIONS, in every node
 * child) with one that appends the URL to that file and fails, so a test can
 * assert that a command made no network request.
 */
import { appendFileSync } from "node:fs";

const log = process.env.NDX_TEST_FETCH_LOG;

if (log) {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    appendFileSync(log, `${url}\n`);
    throw new TypeError("fetch refused by the test's fetch recorder");
  };
}
