/**
 * Tests for the codex-cli-provider output validation logic:
 * - empty output file → retryable ClaudeClientError
 * - missing output file (ENOENT) → retryable ClaudeClientError
 * - trimmed text returned when file has content
 *
 * These tests mock Node.js spawn and fs/promises to simulate Codex exiting 0
 * while producing no output — a failure mode that previously returned an
 * opaque "Invalid JSON" error instead of a retryable provider error.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

// ── Mock declarations (hoisted above imports by vitest) ──────────────────────

const { mockReadFile, mockMkdtemp, mockRm, mockSpawn } = vi.hoisted(() => {
  const mockReadFile = vi.fn();
  const mockMkdtemp = vi.fn(async () => "/tmp/ndx-codex-test-123");
  const mockRm = vi.fn(async () => undefined);
  const mockSpawn = vi.fn();

  return { mockReadFile, mockMkdtemp, mockRm, mockSpawn };
});

vi.mock("node:fs/promises", () => ({
  mkdtemp: mockMkdtemp,
  readFile: mockReadFile,
  rm: mockRm,
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock ChildProcess that exits with the given code after one
 * microtask tick. stderr emits no data.
 */
function mockProcess(exitCode: number, stderr = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stderr: Readable;
    stdout: null;
    stdin: EventEmitter & { write: () => void; end: () => void };
  };
  proc.stderr = new EventEmitter() as unknown as Readable;
  proc.stdout = null;
  // stdin is a writable stream in production — the provider attaches an
  // 'error' listener (EPIPE guard), so the mock must be an EventEmitter.
  proc.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  process.nextTick(() => {
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
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
    mockSpawn.mockReturnValue(mockProcess(0));
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
    mockSpawn.mockReturnValue(mockProcess(0));
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
    mockSpawn.mockReturnValue(mockProcess(0));
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

  it("re-throws non-ENOENT readFile errors without wrapping", async () => {
    mockSpawn.mockReturnValue(mockProcess(0));
    const accessDenied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    mockReadFile.mockRejectedValue(accessDenied);

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });

    await expect(client.complete({ prompt: "test", model: "gpt-5-codex" })).rejects.toThrow(
      "EACCES",
    );
  });

  it("returns trimmed text when the output file has content", async () => {
    mockSpawn.mockReturnValue(mockProcess(0));
    mockReadFile.mockResolvedValue('  [{"epic":{"title":"Auth"},"features":[]}]\n');

    const client = createCodexCliClient({ codexConfig: { cli_path: "codex" }, maxRetries: 0 });
    const result = await client.complete({ prompt: "test", model: "gpt-5-codex" });

    expect(result.text).toBe('[{"epic":{"title":"Auth"},"features":[]}]');
  });
});

describe("Codex literal model execution", () => {
  it("sends an intentional API model pin unchanged", async () => {
    mockSpawn.mockClear();
    mockSpawn.mockReturnValue(mockProcess(0));
    mockReadFile.mockResolvedValue("ok");
    const client = createCodexCliClient({ codexConfig: { model: "gpt-5.4" } });
    await client.complete({ prompt: "test" });
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.4");
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
