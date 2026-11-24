/**
 * Tests for the codex-cli-provider output validation logic:
 * - empty output file → retryable ClaudeClientError
 * - missing output file (ENOENT) → retryable ClaudeClientError
 * - exact text returned when file has content
 *
 * These tests mock Node.js spawn and fs/promises to simulate Codex exiting 0
 * while producing no output — a failure mode that previously returned an
 * opaque "Invalid JSON" error instead of a retryable provider error.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, type Readable } from "node:stream";

// Read the model from Codex's argv, or its quoted command behind cmd.exe.
function codexModelPin(args: string[]): string | undefined {
  if (args[0] === "/d" && args.includes("/c")) {
    return args.at(-1)?.match(/(?:^| )"-m" "([^"]*)"(?= |"$)/)?.[1];
  }
  const at = args.indexOf("-m");
  return at === -1 ? undefined : args[at + 1];
}

describe("Codex model-pin assertion argv fixtures (simulated Windows)", () => {
  it.each([
    ["POSIX literal pin", ["exec", "-m", "gpt-5.4"], "gpt-5.4"],
    ["Windows literal pin", ["/d", "/v:off", "/s", "/c", '"codex "exec" "-m" "gpt-5.4""'], "gpt-5.4"],
    ["POSIX wrong pin", ["exec", "-m", "gpt-5.5"], "gpt-5.5"],
    ["Windows wrong pin", ["/d", "/v:off", "/s", "/c", '"codex "exec" "-m" "gpt-5.5""'], "gpt-5.5"],
    ["POSIX missing flag", ["gpt-5.4", "exec"], undefined],
    ["Windows missing flag", ["/d", "/v:off", "/s", "/c", '"codex "exec" "gpt-5.4""'], undefined],
    ["POSIX missing value", ["exec", "-m"], undefined],
    ["Windows missing value", ["/d", "/v:off", "/s", "/c", '"codex "exec" "-m""'], undefined],
  ] as const)("reads the exact model: %s", (_label, args, expected) => {
    expect(codexModelPin([...args])).toBe(expected);
    expect(codexModelPin([...args]) === "gpt-5.4").toBe(expected === "gpt-5.4");
  });
});

// ── Mock declarations (hoisted above imports by vitest) ──────────────────────

const { mockReadFile, mockSpawn } = vi.hoisted(() => {
  const mockReadFile = vi.fn();
  const mockSpawn = vi.fn();

  return { mockReadFile, mockSpawn };
});

vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: mockReadFile,
}));

vi.mock("../../src/codex-scratch-env.js", () => ({ assertCodexScratchEnvironment: vi.fn().mockResolvedValue(undefined) }));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock ChildProcess that exits with the given code after one
 * microtask tick. stderr emits no data.
 */
function mockProcess(exitCode: number, stderr = "", stdout = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stderr: Readable;
    stdout: Readable | null;
    stdin: EventEmitter & { write: () => void; end: () => void };
  };
  proc.stderr = new EventEmitter() as unknown as Readable;
  proc.stdout = stdout ? new PassThrough() : null;
  // stdin is a writable stream in production — the provider attaches an
  // 'error' listener (EPIPE guard), so the mock must be an EventEmitter.
  proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  process.nextTick(() => {
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    if (stdout) proc.stdout!.emit("data", stdout);
    proc.emit("close", exitCode);
  });
  return proc;
}

// ── Import the module under test AFTER mocks are registered ─────────────────

import { createCodexCliClient } from "../../src/codex-cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createCodexCliClient — output validation", () => {
  it("throws a retryable error when the output file is empty", async () => {
    mockSpawn.mockImplementation(() => mockProcess(0));
    mockReadFile.mockResolvedValue("");

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });

    let caught: unknown;
    try {
      await client.complete({ prompt: "test", model: "gpt-5-codex" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClaudeClientError);
    const clientErr = caught as ClaudeClientError;
    expect(clientErr.retryable).toBe(true);
    expect(clientErr.message).toMatch(/empty output/i);
  });

  it("throws a retryable error when the output file is whitespace-only", async () => {
    mockSpawn.mockImplementation(() => mockProcess(0));
    mockReadFile.mockResolvedValue("   \n  ");

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });

    let caught: unknown;
    try {
      await client.complete({ prompt: "test", model: "gpt-5-codex" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClaudeClientError);
    const clientErr = caught as ClaudeClientError;
    expect(clientErr.retryable).toBe(true);
  });

  it("throws a retryable error when the output file is missing (ENOENT)", async () => {
    mockSpawn.mockImplementation(() => mockProcess(0));
    const enoent = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    mockReadFile.mockRejectedValue(enoent);

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });

    let caught: unknown;
    try {
      await client.complete({ prompt: "test", model: "gpt-5-codex" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClaudeClientError);
    const clientErr = caught as ClaudeClientError;
    expect(clientErr.retryable).toBe(true);
    expect(clientErr.message).toMatch(/output file/i);
  });

  it("retains measured usage on an unwrapped non-ENOENT output read error", async () => {
    mockSpawn.mockImplementation(() => mockProcess(0, "", JSON.stringify({
      type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 },
    })));
    const accessDenied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    mockReadFile.mockRejectedValue(accessDenied);
    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });
    const result = client.complete({ prompt: "test", model: "gpt-5-codex" });
    await expect(result).rejects.toBe(accessDenied);
    await expect(result).rejects.toMatchObject({
      tokenUsage: { input: 20, output: 5, cacheReadInput: 80 }, usageStatus: "measured",
    });
  });

  it("returns exact text when the output file has content", async () => {
    mockSpawn.mockImplementation(() => mockProcess(0));
    mockReadFile.mockResolvedValue('  [{"epic":{"title":"Auth"},"features":[]}]\n');

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });
    const result = await client.complete({ prompt: "test", model: "gpt-5-codex" });

    expect(result.text).toBe('  [{"epic":{"title":"Auth"},"features":[]}]\n');
  });
});

describe("Codex literal model execution", () => {
  it("sends an intentional API model pin unchanged", async () => {
    mockSpawn.mockClear();
    mockSpawn.mockImplementation(() => mockProcess(0));
    mockReadFile.mockResolvedValue("ok");
    const client = createCodexCliClient({ codexConfig: { model: "gpt-5.4" } });
    await client.complete({ prompt: "test" });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(codexModelPin(args)).toBe("gpt-5.4");
  });
  it("does not retry or substitute a rejected ChatGPT model", async () => {
    mockSpawn.mockClear();
    mockSpawn.mockImplementation(() => mockProcess(1, "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account."));
    const client = createCodexCliClient({ maxRetries: 2 });
    await expect(client.complete({ prompt: "test", model: "gpt-5.4" })).rejects.toMatchObject({
      retryable: false,
      message: expect.stringContaining("explicitly update the originating model pin"),
    });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
