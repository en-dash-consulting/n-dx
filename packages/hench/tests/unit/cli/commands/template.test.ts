import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cmdTemplate } from "../../../../src/cli/commands/template.js";
import { saveTemplate } from "../../../../src/store/templates.js";
import { initConfig, loadConfig } from "../../../../src/store/config.js";
import { DEFAULT_HENCH_CONFIG } from "../../../../src/schema/v1.js";
import type { WorkflowTemplate } from "../../../../src/schema/templates.js";

describe("cmdTemplate apply", () => {
  let tmpDir: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-template-cmd-"));
    henchDir = join(tmpDir, ".hench");
    await initConfig(henchDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("applies a fully valid template without warning", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const template: WorkflowTemplate = {
      id: "valid-template",
      name: "Valid Template",
      description: "test",
      useCases: [],
      tags: [],
      config: { maxTurns: 30 },
      builtIn: false,
      createdAt: new Date().toISOString(),
    };
    await saveTemplate(henchDir, template);

    await cmdTemplate(tmpDir, ["apply", "valid-template"], {});

    const config = await loadConfig(henchDir);
    expect(config.maxTurns).toBe(30);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back an invalid scalar to the current config and warns, naming the field and template — does not throw", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const template: WorkflowTemplate = {
      id: "bad-template",
      name: "Bad Template",
      description: "test",
      useCases: [],
      tags: [],
      // maxTurns fails HenchConfigSchema (must be positive); model is valid
      // and should still apply.
      config: { maxTurns: -5, model: "opus" },
      builtIn: false,
      createdAt: new Date().toISOString(),
    };
    await saveTemplate(henchDir, template);

    await expect(cmdTemplate(tmpDir, ["apply", "bad-template"], {})).resolves.not.toThrow();

    const config = await loadConfig(henchDir);
    expect(config.maxTurns).toBe(DEFAULT_HENCH_CONFIG().maxTurns);
    expect(config.model).toBe("opus");

    const warnings = errorSpy.mock.calls.map((args) => args.join(" "));
    expect(warnings.some((line) => line.includes("hench.maxTurns") && line.includes("Bad Template"))).toBe(true);
  });
});
