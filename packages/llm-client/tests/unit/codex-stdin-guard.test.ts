import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock spawnCli so we can hand the provider a controllable fake child process.
// diagnoseCliInvocation / isCliNotFoundError stay real (spread from actual).
vi.mock("../../src/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/exec.js")>();
  return { ...actual, spawnCli: vi.fn() };
});

import { spawnCli } from "../../src/exec.js";
import { createCodexCliClient } from "../../src/codex-cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";

/** Minimal fake ChildProcess with pipe-able stdin/stderr event emitters. */
function makeFakeChild() {
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  });
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stderr,
    stdout: null,
    kill: vi.fn(),
  });
  return proc as typeof proc & { stdin: typeof stdin; stderr: EventEmitter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("codex-cli-provider stdin guard (EPIPE)", () => {
  it("attaches a no-op stdin 'error' handler like cli-provider", async () => {
    const child = makeFakeChild();
    vi.mocked(spawnCli).mockReturnValue(child as never);

    const client = createCodexCliClient({
      codexConfig: { cli_path: "codex" },
      maxRetries: 0,
    });

    const completion = client.complete({ prompt: "hello", model: "test-model" });

    // spawnOnce awaits mkdtemp before spawning — wait for the spawn call.
    await vi.waitFor(() => expect(spawnCli).toHaveBeenCalled());

    // The guard must be attached before/at the stdin write.
    expect(child.stdin.listenerCount("error")).toBeGreaterThan(0);

    // Emitting 'error' must NOT throw (would be an unhandled 'error' otherwise).
    expect(() => child.stdin.emit("error", new Error("EPIPE"))).not.toThrow();

    // Let the process finish so complete() settles.
    child.emit("close", 1);
    await expect(completion).rejects.toBeInstanceOf(ClaudeClientError);
  });
});
