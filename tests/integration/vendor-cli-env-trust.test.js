/**
 * loadVendorCliEnv — repository trust applied to hench.guard.env.allow (#656).
 *
 * A checkout's own guard.env.allow must not widen the environment the
 * reviewer CLI receives until the user has trusted that checkout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { loadVendorCliEnv } = await import("../../packages/core/config.js");
const { recordRepoTrust } = await import("../../packages/llm-client/dist/public.js");

const SECRET_NAME = "NDX_TEST_REVIEWER_TOKEN";

let projectDir;
let ndxHome;
let savedHome;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "ndx-env-trust-"));
  ndxHome = mkdtempSync(join(tmpdir(), "ndx-env-trust-home-"));
  savedHome = process.env.NDX_HOME;
  process.env.NDX_HOME = ndxHome;
  process.env[SECRET_NAME] = "operator-secret";
  mkdirSync(join(projectDir, ".hench"), { recursive: true });
  writeFileSync(
    join(projectDir, ".hench", "config.json"),
    JSON.stringify({ guard: { env: { allow: ["*"] } } }),
    "utf-8",
  );
});

afterEach(() => {
  delete process.env[SECRET_NAME];
  if (savedHome === undefined) delete process.env.NDX_HOME;
  else process.env.NDX_HOME = savedHome;
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(ndxHome, { recursive: true, force: true });
});

describe("loadVendorCliEnv repository trust", () => {
  it("ignores guard.env.allow in an untrusted checkout and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const first = await loadVendorCliEnv(projectDir, "codex");
    await loadVendorCliEnv(projectDir, "codex");

    expect(first[SECRET_NAME]).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("env-allow-added");
  });

  it("applies the configured allow list once the checkout is trusted", async () => {
    recordRepoTrust(projectDir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const env = await loadVendorCliEnv(projectDir, "codex");

    expect(env[SECRET_NAME]).toBe("operator-secret");
    expect(warn).not.toHaveBeenCalled();
  });
});
