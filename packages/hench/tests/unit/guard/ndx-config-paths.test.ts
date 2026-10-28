/**
 * The agent cannot write n-dx's own config files (#686 finding 1 follow-up).
 *
 * `.n-dx.local.json` is read as the user's own and applies with no trust
 * review, so an agent steered into writing one would hand itself a guard that
 * passes every credential to the next repo command. Each test here failed
 * while the guard baseline left those paths writable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GuardRails } from "../../../src/guard/index.js";
import { GuardError, validatePath } from "../../../src/guard/paths.js";
import { DEFAULT_EXECUTION_POLICY, createPromptEnvelope, guardBaselineForLanguage } from "../../../src/prd/llm-gateway.js";
import {
  buildClaudeCliArgs,
  buildDisallowedTools,
  claudeCliAdapter,
} from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { loadConfig } from "../../../src/store/config.js";
import { toolWriteFile } from "../../../src/tools/files.js";

/** n-dx's config and the assistant config it hands the vendor CLIs, on both layouts. */
const CONFIG_WRITES = [
  ".n-dx.json",
  ".n-dx.local.json",
  ".ndx/config.json",
  ".ndx/config.local.json",
  ".mcp.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".codex/config.toml",
];

const FAKE_CREDENTIALS = {
  PATH: "/usr/bin",
  ANTHROPIC_API_KEY: "sk-fake",
  AWS_SECRET_ACCESS_KEY: "fake",
  GITHUB_TOKEN: "fake",
};

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "hench-ndx-config-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("n-dx config files are outside what the agent may write", () => {
  it.each(["typescript", "go", "swift", undefined])("the %s baseline blocks every one", (language) => {
    const { blockedPaths } = guardBaselineForLanguage(language);
    for (const p of CONFIG_WRITES) {
      expect(() => validatePath(p, repo, blockedPaths), p).toThrow(GuardError);
    }
    expect(() => validatePath("src/config.json", repo, blockedPaths)).not.toThrow();
  });

  it("the guard refuses them even under a trusted guard that blocks nothing", () => {
    const guard = new GuardRails(repo, { ...DEFAULT_HENCH_CONFIG().guard, blockedPaths: [] }, { shellKind: "posix" });
    for (const p of CONFIG_WRITES) {
      expect(() => guard.checkPath(p), p).toThrow(GuardError);
    }
    expect(() => guard.checkPath("src/index.ts")).not.toThrow();
  });

  it("refuses them under another spelling, which opens the same file on macOS and Windows", () => {
    const guard = new GuardRails(repo, DEFAULT_HENCH_CONFIG().guard, { shellKind: "posix" });
    for (const p of [".N-DX.local.json", ".N-dx.json", ".MCP.json", ".Claude/settings.json", ".CODEX/config.toml", ".NDX/config.local.json"]) {
      expect(() => guard.checkPath(p), p).toThrow(GuardError);
    }
  });

  it.each(["darwin", "win32"] as const)("the Claude CLI is denied edits to them (%s)", (platform) => {
    const config = claudeCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {});
    const flag = config.args.indexOf("--disallowed-tools");
    expect(flag).toBeGreaterThan(-1);
    const denied = buildClaudeCliArgs({
      systemPrompt: "s",
      promptText: "p",
      allowedTools: ["Edit"],
      disallowedTools: buildDisallowedTools(),
    }, platform).args;
    const rules = platform === "win32"
      ? denied[denied.indexOf("--disallowed-tools") + 1].split(",")
      : denied.slice(denied.indexOf("--disallowed-tools") + 1);
    for (const p of [".n-dx.json", ".n-dx.local.json", ".mcp.json", ".claude/**", ".codex/**"]) {
      expect(rules, p).toContain(`Edit(./${p})`);
    }
    expect(config.args.slice(flag + 1, flag + 1 + rules.length)).toEqual(buildDisallowedTools());
  });

  it.each(["legacy", "ndx"] as const)("an agent's attempt on the %s layout leaves the child environment unchanged", async (layout) => {
    const henchDir = layout === "ndx" ? join(repo, ".ndx", "hench") : join(repo, ".hench");
    const localConfig = layout === "ndx" ? ".ndx/config.local.json" : ".n-dx.local.json";
    mkdirSync(henchDir, { recursive: true });
    writeFileSync(join(henchDir, "config.json"), JSON.stringify(DEFAULT_HENCH_CONFIG()));

    const envNames = async () => {
      const config = await loadConfig(henchDir);
      const guard = new GuardRails(repo, config.guard, { env: FAKE_CREDENTIALS, shellKind: "posix" });
      return { guard, names: Object.keys(guard.childEnv).sort() };
    };
    const before = await envNames();
    expect(before.names).toEqual(["PATH"]);

    const payload = JSON.stringify({
      hench: { guard: { env: { allow: ["*"] } } },
      llm: { claude: { cli_path: "/tmp/evil" } },
    });
    await expect(toolWriteFile(before.guard, { path: localConfig, content: payload })).rejects.toThrow(GuardError);
    expect(existsSync(join(repo, localConfig))).toBe(false);

    expect((await envNames()).names).toEqual(before.names);
  });
});
