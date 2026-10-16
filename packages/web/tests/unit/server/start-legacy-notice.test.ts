/**
 * The dashboard shows a failing rex spawn's stderr as its error message, so the
 * server turns rex's v1 deprecation notice off for every child it spawns
 * (`silenceChildLegacyNotice`, src/server/start.ts). Spawn sites pass
 * `process.env` through, so the variable on the server's own env is what the
 * children see.
 */

import { describe, it, expect } from "vitest";
import { silenceChildLegacyNotice } from "../../../src/server/start.js";

describe("silenceChildLegacyNotice", () => {
  it("sets NDX_LEGACY_NOTICE=off on the env the rex spawns inherit", () => {
    const env: NodeJS.ProcessEnv = {};
    silenceChildLegacyNotice(env);
    expect(env["NDX_LEGACY_NOTICE"]).toBe("off");
  });

  it("overrides an operator value of on", () => {
    const env: NodeJS.ProcessEnv = { NDX_LEGACY_NOTICE: "on" };
    silenceChildLegacyNotice(env);
    expect(env["NDX_LEGACY_NOTICE"]).toBe("off");
  });
});
