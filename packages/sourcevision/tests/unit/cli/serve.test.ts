import { describe, it, expect, vi, afterEach } from "vitest";
import type { ManagedChild, SpawnToolResult } from "@n-dx/llm-client";

vi.mock("@n-dx/llm-client", () => ({
  spawnManaged: vi.fn(),
  killWithFallback: vi.fn(),
}));

import { spawnManaged, killWithFallback } from "@n-dx/llm-client";
import { startServe } from "../../../src/cli/serve.js";

const mockSpawnManaged = vi.mocked(spawnManaged);
const mockKillWithFallback = vi.mocked(killWithFallback);

function createManagedChild(): ManagedChild & {
  resolveDone: (result: SpawnToolResult) => void;
  kill: ReturnType<typeof vi.fn>;
} {
  let resolveDone!: (result: SpawnToolResult) => void;
  const done = new Promise<SpawnToolResult>((resolve) => {
    resolveDone = resolve;
  });

  return {
    done,
    kill: vi.fn().mockReturnValue(true),
    pid: 12345,
    resolveDone,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("startServe", () => {
  it("exits with the delegated web CLI exit code", async () => {
    const handle = createManagedChild();
    mockSpawnManaged.mockReturnValue(handle);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    const promise = startServe("/tmp/project", 4117);
    handle.resolveDone({ exitCode: 0, stdout: "", stderr: "" });

    await expect(promise).rejects.toThrow("process.exit:0");
    expect(mockSpawnManaged).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["serve", "--scope=sourcevision", "--port=4117", "/tmp/project"]),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("forwards SIGTERM to the delegated child before re-raising the signal", async () => {
    const handle = createManagedChild();
    mockSpawnManaged.mockReturnValue(handle);
    mockKillWithFallback.mockResolvedValue(undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as never);

    const promise = startServe("/tmp/project", 3117);
    process.emit("SIGTERM");
    await Promise.resolve();

    expect(mockKillWithFallback).toHaveBeenCalledWith(handle, 2_000);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

    handle.resolveDone({ exitCode: 0, stdout: "", stderr: "" });
    await promise;
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
