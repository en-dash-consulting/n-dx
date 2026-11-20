/**
 * `ndx config cli.timeoutMs` must report the default the CLI actually applies.
 *
 * cli-timeout.js owns the global command timeout (DEFAULT_TIMEOUT_MS). config.js
 * prints that default for an unset `cli.timeoutMs`, but may import nothing
 * beyond node builtins and its listed same-package helpers
 * (tests/e2e/domain-isolation.test.js), so it keeps a copy. This pins the copy
 * to the canonical value: change one without the other and this fails.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_TIMEOUT_MS } from "../../packages/core/cli-timeout.js";
import { CLI_TIMEOUT_DEFAULT_MS } from "../../packages/core/config.js";

describe("CLI timeout default", () => {
  it("config.js's copy matches cli-timeout.js", () => {
    expect(CLI_TIMEOUT_DEFAULT_MS).toBe(DEFAULT_TIMEOUT_MS);
  });
});
