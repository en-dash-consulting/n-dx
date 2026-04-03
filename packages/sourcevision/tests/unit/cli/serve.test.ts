import { describe, it, expect, vi, afterEach } from "vitest";
import type { SpawnToolResult } from "@n-dx/llm-client";

vi.mock("@n-dx/llm-client", () => ({
  spawnTool: vi.fn(),
}));

import { spawnTool } from "@n-dx/llm-client";
import { startServe } from "../../../src/cli/serve.js";

const mockSpawnTool = vi.mocked(spawnTool);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("startServe", () => {
  it("exits with the delegated web CLI exit code", async () => {
    mockSpawnTool.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" } satisfies SpawnToolResult);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    await expect(startServe("/tmp/project", 4117)).rejects.toThrow("process.exit:0");
    expect(mockSpawnTool).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["serve", "--scope=sourcevision", "--port=4117", "/tmp/project"]),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("uses a non-zero exit code when the delegated CLI has no exit code", async () => {
    mockSpawnTool.mockResolvedValue({ exitCode: null, stdout: "", stderr: "" } satisfies SpawnToolResult);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    await expect(startServe("/tmp/project", 3117)).rejects.toThrow("process.exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
