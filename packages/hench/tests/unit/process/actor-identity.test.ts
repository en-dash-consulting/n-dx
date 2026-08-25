import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecStdout, mockUserInfo, mockHostname } = vi.hoisted(() => ({
  mockExecStdout: vi.fn(),
  mockUserInfo: vi.fn(),
  mockHostname: vi.fn(),
}));

vi.mock("../../../src/process/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/exec.js")>();
  return {
    ...actual,
    execStdout: mockExecStdout,
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    userInfo: mockUserInfo,
    hostname: mockHostname,
  };
});

import {
  resolveActor,
  resolveHost,
  _resetActorCacheForTests,
} from "../../../src/process/actor-identity.js";

/** Configure the mocked `git config --get <key>` to return `values[key]` (or empty output when unset). */
function mockGitConfig(values: Record<string, string | undefined>): void {
  mockExecStdout.mockImplementation(async (_cmd: string, args: string[]) => {
    const key = args[args.length - 1];
    return values[key] ?? "";
  });
}

beforeEach(() => {
  _resetActorCacheForTests();
  mockExecStdout.mockReset();
  mockUserInfo.mockReset();
  mockHostname.mockReset();
});

describe("resolveActor", () => {
  it("combines git user.name and user.email when both are set", async () => {
    mockGitConfig({ "user.name": "Ada Lovelace", "user.email": "ada@example.com" });

    const actor = await resolveActor();

    expect(actor).toBe("Ada Lovelace <ada@example.com>");
  });

  it("falls back to user.name alone when user.email is unset", async () => {
    mockGitConfig({ "user.name": "Ada Lovelace" });

    const actor = await resolveActor();

    expect(actor).toBe("Ada Lovelace");
  });

  it("falls back to user.email alone when user.name is unset", async () => {
    mockGitConfig({ "user.email": "ada@example.com" });

    const actor = await resolveActor();

    expect(actor).toBe("ada@example.com");
  });

  it("falls back to os.userInfo().username when git config is entirely unset", async () => {
    mockGitConfig({});
    mockUserInfo.mockReturnValue({ username: "ada-local" });

    const actor = await resolveActor();

    expect(actor).toBe("ada-local");
  });

  it("falls back to 'unknown' when os.userInfo() throws", async () => {
    mockGitConfig({});
    mockUserInfo.mockImplementation(() => {
      throw new Error("no passwd entry for uid");
    });

    const actor = await resolveActor();

    expect(actor).toBe("unknown");
  });

  it("falls back to 'unknown' when os.userInfo() returns an empty username", async () => {
    mockGitConfig({});
    mockUserInfo.mockReturnValue({ username: "" });

    const actor = await resolveActor();

    expect(actor).toBe("unknown");
  });

  it("caches the resolved actor across calls, never re-reading git config", async () => {
    mockGitConfig({ "user.name": "Ada Lovelace", "user.email": "ada@example.com" });

    const first = await resolveActor();
    // Change what git config would report — the cached value must not change.
    mockGitConfig({ "user.name": "Someone Else", "user.email": "else@example.com" });
    const second = await resolveActor();

    expect(second).toBe(first);
    expect(mockExecStdout).toHaveBeenCalledTimes(2); // one for name, one for email — only on the first call
  });

  it("re-resolves after _resetActorCacheForTests()", async () => {
    mockGitConfig({ "user.name": "Ada Lovelace", "user.email": "ada@example.com" });
    const first = await resolveActor();

    _resetActorCacheForTests();
    mockGitConfig({ "user.name": "Grace Hopper", "user.email": "grace@example.com" });
    const second = await resolveActor();

    expect(first).toBe("Ada Lovelace <ada@example.com>");
    expect(second).toBe("Grace Hopper <grace@example.com>");
  });
});

describe("resolveHost", () => {
  it("returns os.hostname()", () => {
    mockHostname.mockReturnValue("build-agent-7");

    expect(resolveHost()).toBe("build-agent-7");
  });

  it("falls back to 'unknown' when os.hostname() throws", () => {
    mockHostname.mockImplementation(() => {
      throw new Error("hostname unavailable");
    });

    expect(resolveHost()).toBe("unknown");
  });

  it("falls back to 'unknown' when os.hostname() returns an empty string", () => {
    mockHostname.mockReturnValue("");

    expect(resolveHost()).toBe("unknown");
  });
});
