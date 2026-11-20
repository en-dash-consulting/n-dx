import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the real default prompt, replacing only terminal I/O in a disposable
// process so neither TTY state nor Enquirer's CommonJS cache leaks to other tests.
function selectModel({ choice, switchTo } = {}) {
  const script = `
    import { createRequire } from "node:module";
    import { promptLLMSelection, resolveInitLLMSelection } from "./packages/core/init-llm.js";
    const require = createRequire(new URL("./packages/core/init-llm.js", import.meta.url));
    const Enquirer = require("enquirer");
    process.stdin.isTTY = true;
    delete process.env.CI;
    let choices, initial;
    Enquirer.prototype.prompt = async (options) => {
      choices = options.choices.map((c) => c.name);
      initial = choices[options.initial];
      return { model: ${JSON.stringify(choice) ?? "undefined"} ?? initial };
    };
    const resolution = resolveInitLLMSelection({
      flags: { provider: "codex" },
      existingConfig: { vendor: "codex", model: "gpt-5.2" }, isTTY: true,
    });
    const switchTo = ${JSON.stringify(switchTo) ?? "undefined"};
    if (switchTo) resolution.needsProviderPrompt = true;
    const result = await promptLLMSelection(resolution, {
      promptProvider: async () => switchTo,
      existingModels: { codex: "gpt-5.2", claude: "claude-opus-4-20250514" },
    });
    console.log(JSON.stringify({ result, choices, initial }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 10000,
  }));
}

describe("interactive model confirmation", () => {
  it("does not restore an incompatible destination pin in Ink init", () => {
    const dir = mkdtempSync(join(tmpdir(), "ndx-ink-model-"));
    const file = join(dir, ".n-dx.json");
    try {
      writeFileSync(file, JSON.stringify({ llm: {
        vendor: "codex", claude: { model: "gpt-5.2" }, codex: { model: "gpt-5.2" },
      } }));
      const script = `
        import { renderInit } from "./packages/core/cli-ink.js";
        import { resolveInitLLMSelection } from "./packages/core/init-llm.js";
        const selection = resolveInitLLMSelection({
          flags: { provider: "claude" },
          existingConfig: { vendor: "codex", models: { claude: "gpt-5.2" } },
          isTTY: true,
        });
        const result = await renderInit({
          dir: ${JSON.stringify(dir)}, flags: [], provider: selection.provider,
          providerSourceKey: selection.providerSource, model: selection.model,
          modelSource: "from existing config", assistantEnabled: { claude: false, codex: false },
          tools: {}, runInitCapture: async () => ({ code: 0 }), commitInit: false,
        });
        process.exitCode = result.code;
      `;
      const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 30000,
        env: { ...process.env, CI: "1", CODEX_HOME: dir, CLAUDE_CONFIG_DIR: dir },
      });
      const config = JSON.parse(readFileSync(file, "utf8"));
      expect(config.llm.vendor).toBe("claude");
      expect(config.llm.claude.model).toBeUndefined();
      expect(config.llm.codex.model).toBe("gpt-5.2");
      expect(output).toContain("not compatible with claude");
      expect(output).toMatch(/Model +not set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([undefined, "gpt-5.5"])("keeps an off-catalog pin on Enter, with explicit choice %s", (choice) => {
    const { result, choices, initial } = selectModel({ choice });
    expect(initial).toBe("gpt-5.2");
    expect(choices).toContain("gpt-5.5");
    expect(result.model).toBe(choice ?? "gpt-5.2");
    expect(result.cancelled).toBe(false);
  });

  it("preselects the destination vendor's own pin when switching interactively", () => {
    const { result, initial } = selectModel({ switchTo: "claude" });
    expect(initial).toBe("claude-opus-4-20250514");
    expect(result.model).toBe(initial);
  });
});
