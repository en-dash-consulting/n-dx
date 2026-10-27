/**
 * The root setupFile hides ambient agent-run state from the suite, so a test
 * run inside an `ndx work` gate behaves as it does in CI.
 *
 * @see tests/setup-session-env.js
 */
import { describe, it, expect, afterEach } from "vitest";

const SETUP = new URL("../setup-session-env.js", import.meta.url).href;

describe("setup-session-env", () => {
  const prev = process.env.NDX_AGENT_RUN;

  afterEach(() => {
    if (prev === undefined) delete process.env.NDX_AGENT_RUN;
    else process.env.NDX_AGENT_RUN = prev;
  });

  it("clears NDX_AGENT_RUN, which an ndx work run's test gate inherits", async () => {
    process.env.NDX_AGENT_RUN = "1";
    // A query string makes a fresh module instance; the setupFile already ran the plain URL.
    await import(`${SETUP}?agent-run`);
    expect(process.env.NDX_AGENT_RUN).toBeUndefined();
  });
});
