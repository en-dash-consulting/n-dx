import { describe, it, expect, vi } from "vitest";
import { createLLMClient, detectLLMAuthMode } from "../../src/llm-client.js";

describe("createLLMClient", () => {
  it("creates a Claude client from llmConfig.claude", () => {
    const client = createLLMClient({
      llmConfig: {
        vendor: "claude",
        claude: { api_key: "sk-ant-test" },
      },
    });

    expect(client.mode).toBe("api");
  });

  it("creates a Codex client from llmConfig.codex", () => {
    const client = createLLMClient({
      vendor: "codex",
      llmConfig: {
        codex: { cli_path: "/usr/local/bin/codex", model: "gpt-5-codex" },
      },
    });
    expect(client.mode).toBe("cli");
  });
});

describe("detectLLMAuthMode", () => {
  it("delegates to Claude auth detection", () => {
    const mode = detectLLMAuthMode({
      llmConfig: {
        claude: { api_key: "sk-ant-test" },
      },
    });
    expect(mode).toBe("api");
  });

  it("returns cli for codex placeholder", () => {
    // Ensure no OPENAI_API_KEY in env so the test exercises the no-key → cli path.
    vi.stubEnv("OPENAI_API_KEY", "");
    const mode = detectLLMAuthMode({ vendor: "codex" });
    vi.unstubAllEnvs();
    expect(mode).toBe("cli");
  });
});
