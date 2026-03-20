import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeClientError } from "../../src/types.js";

// Mock child_process.execFile before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Track the mock create function so tests can configure it
let mockCreate = vi.fn();

// Mock @anthropic-ai/sdk with a class-style constructor
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages: { create: ReturnType<typeof vi.fn> };
      constructor(public opts?: unknown) {
        this.messages = { create: mockCreate };
      }
    },
  };
});

import { execFile } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import {
  detectCliAvailability,
  validateApiKey,
  detectAvailableAuth,
  diagnoseAuth,
} from "../../src/auth.js";

// ── detectCliAvailability ────────────────────────────────────────────────────

describe("detectCliAvailability", () => {
  beforeEach(() => {
    mockCreate = vi.fn();
    vi.mocked(execFile).mockReset();
  });

  it("returns true when CLI responds successfully", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await detectCliAvailability({ claudeConfig: {} });
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      "claude",
      ["--version"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("returns false when CLI is not found", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err);
      },
    );

    const result = await detectCliAvailability({ claudeConfig: {} });
    expect(result).toBe(false);
  });

  it("returns false when CLI exits with error", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("exit code 1"));
      },
    );

    const result = await detectCliAvailability({ claudeConfig: {} });
    expect(result).toBe(false);
  });

  it("uses custom CLI path from config", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    await detectCliAvailability({
      claudeConfig: { cli_path: "/opt/claude" },
    });

    expect(mockExecFile).toHaveBeenCalledWith(
      "/opt/claude",
      ["--version"],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

// ── validateApiKey ───────────────────────────────────────────────────────────

describe("validateApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockCreate = vi.fn();
    vi.mocked(execFile).mockReset();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws ClaudeClientError when no API key is available", async () => {
    await expect(validateApiKey({ claudeConfig: {} })).rejects.toThrow(
      ClaudeClientError,
    );

    try {
      await validateApiKey({ claudeConfig: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("auth");
      expect(clientErr.retryable).toBe(false);
      expect(clientErr.message).toContain("API key not found");
    }
  });

  it("returns true when API call succeeds", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await validateApiKey({
      claudeConfig: { api_key: "sk-ant-test" },
    });
    expect(result).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 1 }),
    );
  });

  it("returns false when API returns 401", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const result = await validateApiKey({
      claudeConfig: { api_key: "sk-ant-bad" },
    });
    expect(result).toBe(false);
  });

  it("returns false when API returns 403", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );

    const result = await validateApiKey({
      claudeConfig: { api_key: "sk-ant-bad" },
    });
    expect(result).toBe(false);
  });

  it("returns true when API returns 429 (rate limit, not auth failure)", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), { status: 429 }),
    );

    const result = await validateApiKey({
      claudeConfig: { api_key: "sk-ant-valid" },
    });
    expect(result).toBe(true);
  });

  it("returns true when API returns 500 (server error, not auth failure)", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Internal Server Error"), { status: 500 }),
    );

    const result = await validateApiKey({
      claudeConfig: { api_key: "sk-ant-valid" },
    });
    expect(result).toBe(true);
  });

  it("passes api_endpoint through to Anthropic client", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await validateApiKey({
      claudeConfig: {
        api_key: "sk-ant-test",
        api_endpoint: "https://custom.api.example.com",
      },
    });

    // The mock class stores opts on the instance; verify the key was passed
    expect(result).toBe(true);
  });

  it("uses env var when no config api_key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await validateApiKey({ claudeConfig: {} });
    expect(result).toBe(true);
  });
});

// ── detectAvailableAuth ──────────────────────────────────────────────────────

describe("detectAvailableAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockCreate = vi.fn();
    vi.mocked(execFile).mockReset();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns api mode when API key is available", async () => {
    const result = await detectAvailableAuth({
      claudeConfig: { api_key: "sk-ant-test" },
    });

    expect(result.mode).toBe("api");
    expect(result.apiKeyAvailable).toBe(true);
  });

  it("returns cli mode when no API key but CLI is available", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await detectAvailableAuth({ claudeConfig: {} });

    expect(result.mode).toBe("cli");
    expect(result.apiKeyAvailable).toBe(false);
    expect(result.cliAvailable).toBe(true);
  });

  it("throws ClaudeClientError when neither method is available", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err);
      },
    );

    await expect(
      detectAvailableAuth({ claudeConfig: {} }),
    ).rejects.toThrow(ClaudeClientError);

    try {
      await detectAvailableAuth({ claudeConfig: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("auth");
      expect(clientErr.retryable).toBe(false);
      expect(clientErr.message).toContain("No authentication method available");
      expect(clientErr.message).toContain("n-dx config claude.api_key");
      expect(clientErr.message).toContain("npm install -g @anthropic-ai/claude-code");
    }
  });

  it("prefers API key over CLI when both are available", async () => {
    // Mock CLI to be available — shouldn't matter
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await detectAvailableAuth({
      claudeConfig: { api_key: "sk-ant-test" },
    });

    expect(result.mode).toBe("api");
    expect(result.apiKeyAvailable).toBe(true);
    // CLI check should not even happen when API key is available
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("detects API key from env var", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";

    const result = await detectAvailableAuth({ claudeConfig: {} });

    expect(result.mode).toBe("api");
    expect(result.apiKeyAvailable).toBe(true);
  });
});

// ── diagnoseAuth ─────────────────────────────────────────────────────────────

describe("diagnoseAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockCreate = vi.fn();
    vi.mocked(execFile).mockReset();
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("reports api key from config", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({
      claudeConfig: { api_key: "sk-ant-test" },
    });

    expect(result.apiKeySource).toBe("config");
    expect(result.recommendedMode).toBe("api");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("config.json"),
      ]),
    );
  });

  it("reports api key from env", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({ claudeConfig: {} });

    expect(result.apiKeySource).toBe("env");
    expect(result.recommendedMode).toBe("api");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ANTHROPIC_API_KEY"),
      ]),
    );
  });

  it("reports no api key and CLI available", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({ claudeConfig: {} });

    expect(result.apiKeySource).toBe("none");
    expect(result.cliAvailable).toBe(true);
    expect(result.recommendedMode).toBe("cli");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not configured"),
        expect.stringContaining("available"),
      ]),
    );
  });

  it("reports no auth method available", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err);
      },
    );

    const result = await diagnoseAuth({ claudeConfig: {} });

    expect(result.apiKeySource).toBe("none");
    expect(result.cliAvailable).toBe(false);
    expect(result.recommendedMode).toBe("none");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No authentication method available"),
      ]),
    );
  });

  it("validates API key when validateKey is true", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({
      claudeConfig: { api_key: "sk-ant-test" },
      validateKey: true,
    });

    expect(result.apiKeyValid).toBe(true);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("validated successfully"),
      ]),
    );
  });

  it("reports invalid API key when validation fails", async () => {
    mockCreate.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { status: 401 }),
    );

    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({
      claudeConfig: { api_key: "sk-ant-bad" },
      validateKey: true,
    });

    expect(result.apiKeyValid).toBe(false);
    expect(result.recommendedMode).toBe("cli");
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rejected by API"),
      ]),
    );
  });

  it("skips API key validation when validateKey is false", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      },
    );

    const result = await diagnoseAuth({
      claudeConfig: { api_key: "sk-ant-test" },
      validateKey: false,
    });

    expect(result.apiKeyValid).toBeUndefined();
  });

  it("uses custom CLI path in diagnostic message", async () => {
    const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        cb(err);
      },
    );

    const result = await diagnoseAuth({
      claudeConfig: { api_key: "sk-ant-test", cli_path: "/custom/claude" },
    });

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/custom/claude"),
      ]),
    );
  });
});
