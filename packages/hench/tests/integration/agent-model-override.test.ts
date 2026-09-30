/**
 * End-to-end contract for the agent-only model override, from the config file
 * `ndx work` actually reads to the model it would run.
 *
 * The unit tests cover the resolution chain in isolation; this one covers the
 * seam between them — that `hench.models` survives schema validation, the
 * `.n-dx.json` merge and the post-merge re-validation, and arrives at
 * `resolveAgentModel` in the shape it expects. A field can be correct in both
 * halves and still be dropped in the middle, which is exactly how the
 * `hench.model` it replaces stayed dead.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveModel, NEWEST_MODELS } from "@n-dx/llm-client";
import { initConfig, loadConfig } from "../../src/store/config.js";
import { resolveAgentModel } from "../../src/cli/commands/agent-model.js";

describe("hench.models override, config file to resolved model", () => {
  let tmpDir: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-agent-model-"));
    henchDir = join(tmpDir, ".hench");
    await initConfig(henchDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeProjectConfig(data: unknown): Promise<void> {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify(data), "utf-8");
  }

  it("carries a .n-dx.json override through to the resolved agent model", async () => {
    await writeProjectConfig({ hench: { models: { claude: "opus" } } });

    const config = await loadConfig(henchDir);
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: config.models,
      llmConfig: { vendor: "claude", claude: { model: "sonnet" } },
    });

    expect(result.model).toBe(resolveModel("opus"));
    expect(result.source).toBe("hench-override");
  });

  it("leaves resolution untouched when the override names a different vendor", async () => {
    await writeProjectConfig({ hench: { models: { codex: "gpt-5.6-terra" } } });

    const config = await loadConfig(henchDir);
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: config.models,
      llmConfig: { vendor: "claude", claude: { model: "sonnet" } },
    });

    expect(result.model).toBe(resolveModel("sonnet"));
    expect(result.source).toBe("configured");
  });

  it("falls back to llm.* resolution when the override is invalid, without stopping", async () => {
    await writeProjectConfig({ hench: { models: { claude: "" } } });

    const warnings: string[] = [];
    const config = await loadConfig(henchDir, {
      onWarning: (message) => warnings.push(message),
    });
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: config.models,
      llmConfig: { vendor: "claude" },
    });

    expect(warnings[0]).toContain("hench.models");
    expect(result.model).toBe(NEWEST_MODELS.claude);
    expect(result.source).toBe("default");
  });

  it("ignores the deprecated hench.model scalar even when it is set", async () => {
    await writeProjectConfig({ hench: { model: "opus" } });

    const config = await loadConfig(henchDir);
    const result = resolveAgentModel({
      vendor: "claude",
      henchModels: config.models,
      llmConfig: { vendor: "claude" },
    });

    // The scalar loaded fine — it is simply never consulted.
    expect(config.model).toBe("opus");
    expect(result.model).toBe(NEWEST_MODELS.claude);
    expect(result.source).toBe("default");
  });
});
