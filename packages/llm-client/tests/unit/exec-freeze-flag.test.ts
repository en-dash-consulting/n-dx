import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Does exec actually ask for the BETA freeze path, and only when enabled?
 *
 * This lives apart from exec.test.ts because it mocks process-tree rather than
 * child_process: the question is what exec REQUESTS, not what the kill does. An
 * earlier attempt asserted it through a fake child instead and was vacuous — a
 * pid-less fake short-circuits terminateProcessTree to a direct kill before the
 * freeze branch is reached, so "no SIGSTOP was sent" held either way.
 */
// vi.hoisted, because vi.mock factories are lifted above module-level consts: a
// plain `const` here is still uninitialised when the factory runs.
const { terminateProcessTree } = vi.hoisted(() => ({
  terminateProcessTree: vi.fn(async () => {}),
}));

vi.mock("../../src/process-tree.js", () => ({
  terminateProcessTree,
  treeKillSpawnOptions: (platform: NodeJS.Platform) =>
    platform === "win32" ? {} : { detached: true },
  treeKillCommand: (pid: number) => ({
    command: "taskkill",
    args: ["/PID", String(pid), "/T", "/F"],
  }),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { exec } from "../../src/exec.js";

const mockSpawn = vi.mocked(spawn);

/** A child that never exits, so only the timeout can settle the call. */
function hangingChild() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(child, {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: () => {} },
    kill: () => true,
  });
  return child as unknown as ReturnType<typeof spawn>;
}

/** Run a command to its timeout and report the `freeze` value exec asked for. */
async function freezeRequestedWith(env: NodeJS.ProcessEnv): Promise<boolean | undefined> {
  mockSpawn.mockImplementation((() => hangingChild()) as unknown as typeof spawn);
  terminateProcessTree.mockClear();

  vi.useFakeTimers();
  try {
    const pending = exec("sleep", ["600"], {
      cwd: "/tmp",
      timeout: 1000,
      _platform: "linux",
      env,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  } finally {
    vi.useRealTimers();
  }

  const opts = terminateProcessTree.mock.calls[0]?.[1] as { freeze?: boolean } | undefined;
  return opts?.freeze;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exec asks for the freeze path only when the BETA flag is set", () => {
  it("requests the default sweep when the flag is absent", async () => {
    expect(await freezeRequestedWith({})).toBe(false);
  });

  it("requests the default sweep when the flag is explicitly off", async () => {
    expect(await freezeRequestedWith({ NDX_POSIX_FREEZE_KILL: "0" })).toBe(false);
  });

  it("requests the freeze path when the flag is on", async () => {
    expect(await freezeRequestedWith({ NDX_POSIX_FREEZE_KILL: "1" })).toBe(true);
  });

  it("lets an explicit option override the flag in both directions", async () => {
    // The flag is a default, not a lock: a caller that knows which policy it wants
    // says so. Graceful shutdown paths depend on being able to refuse the freeze.
    mockSpawn.mockImplementation((() => hangingChild()) as unknown as typeof spawn);
    terminateProcessTree.mockClear();

    vi.useFakeTimers();
    try {
      const pending = exec("sleep", ["600"], {
        cwd: "/tmp",
        timeout: 1000,
        _platform: "linux",
        env: { NDX_POSIX_FREEZE_KILL: "1" },
        freeze: false,
      });
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    const opts = terminateProcessTree.mock.calls[0]?.[1] as { freeze?: boolean } | undefined;
    expect(opts?.freeze).toBe(false);
  });
});
