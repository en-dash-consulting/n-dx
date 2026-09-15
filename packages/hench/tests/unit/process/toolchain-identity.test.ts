import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockReadFileSync } = vi.hoisted(() => ({ mockReadFileSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: mockReadFileSync };
});

import {
  resolveNdxVersion,
  resolveCliPath,
  _resetVersionCacheForTests,
} from "../../../src/process/toolchain-identity.js";

const ENV_KEYS = ["NDX_VERSION", "NDX_CLI_PATH", "N_DX_CLI_PATH"] as const;

let envBackup: Record<string, string | undefined>;
let argvBackup: string[];

beforeEach(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  argvBackup = process.argv;
  mockReadFileSync.mockReset();
  _resetVersionCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
  process.argv = argvBackup;
  _resetVersionCacheForTests();
});

describe("resolveNdxVersion", () => {
  it("reads the version from the package manifest", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.5.9" }));
    expect(resolveNdxVersion()).toBe("0.5.9");
  });

  it("resolves the manifest two levels up from this module", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.5.9" }));
    resolveNdxVersion();
    const [pkgPath] = mockReadFileSync.mock.calls[0] as [string];
    expect(pkgPath.replace(/\\/g, "/")).toMatch(/packages\/hench\/package\.json$/);
  });

  it("prefers NDX_VERSION over the manifest", () => {
    process.env["NDX_VERSION"] = "9.9.9";
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.5.9" }));
    expect(resolveNdxVersion()).toBe("9.9.9");
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns undefined when the manifest is unreadable", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(resolveNdxVersion()).toBeUndefined();
  });

  it("returns undefined when the manifest has no version string", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "@n-dx/hench" }));
    expect(resolveNdxVersion()).toBeUndefined();
  });

  // A memoized failure would pin every later run in the process to undefined,
  // turning one transient fs error into a permanently version-less report.
  it("does not memoize a failed read", () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("EAGAIN");
    });
    expect(resolveNdxVersion()).toBeUndefined();
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.6.0" }));
    expect(resolveNdxVersion()).toBe("0.6.0");
  });

  it("reads the manifest only once after a successful read", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.6.0" }));
    resolveNdxVersion();
    resolveNdxVersion();
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("resolveCliPath", () => {
  it("prefers NDX_CLI_PATH", () => {
    process.env["NDX_CLI_PATH"] = "/a/cli.js";
    process.env["N_DX_CLI_PATH"] = "/b/cli.js";
    process.argv = ["node", "/c/hench.js"];
    expect(resolveCliPath()).toBe("/a/cli.js");
  });

  it("falls back to N_DX_CLI_PATH", () => {
    process.env["N_DX_CLI_PATH"] = "/b/cli.js";
    process.argv = ["node", "/c/hench.js"];
    expect(resolveCliPath()).toBe("/b/cli.js");
  });

  it("falls back to argv[1] when neither env var is set", () => {
    process.argv = ["node", "/c/hench.js"];
    expect(resolveCliPath()).toBe("/c/hench.js");
  });

  it("returns undefined when argv carries no script path", () => {
    process.argv = ["node"];
    expect(resolveCliPath()).toBeUndefined();
  });

  // An empty env var is the shell's way of saying "unset"; treating it as a
  // value would record a blank path in place of a real one.
  it("ignores an empty NDX_CLI_PATH", () => {
    process.env["NDX_CLI_PATH"] = "";
    process.argv = ["node", "/c/hench.js"];
    expect(resolveCliPath()).toBe("/c/hench.js");
  });
});
