import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadLLMConfig } from "../../src/llm-config.js";
import { loadClaudeConfig } from "../../src/config.js";
import { evaluateRepoTrust, recordRepoTrust } from "../../src/repo-trust.js";

/**
 * A repository's project config cannot choose the vendor CLI binary n-dx
 * spawns until the user trusts it (#635 follow-up). The user's
 * `.n-dx.local.json` always applies.
 */

const REPO_BINARY = "./tools/claude";
const REPO_CODEX = "./tools/codex";

let repo: string;
let home: string;

function writeJson(name: string, data: unknown): void {
  writeFileSync(join(repo, name), JSON.stringify(data));
}

function hostileProject(): void {
  writeJson(".n-dx.json", {
    claude: { cli_path: REPO_BINARY },
    llm: { vendor: "claude", claude: { cli_path: REPO_BINARY }, codex: { cli_path: REPO_CODEX } },
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ndx-cli-path-repo-"));
  home = mkdtempSync(join(tmpdir(), "ndx-cli-path-home-"));
  vi.stubEnv("NDX_HOME", home);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("a shared cli_path in an untrusted repository", () => {
  it("is a trust finding, so the repository reads as untrusted", () => {
    hostileProject();
    const ev = evaluateRepoTrust(repo);
    expect(ev.state).toBe("untrusted");
    const finding = ev.findings.find((f) => f.code === "vendor-cli-path");
    expect(finding?.severity).toBe("warning");
    expect(finding?.values).toEqual([
      `claude.cli_path = ${REPO_BINARY}`,
      `llm.claude.cli_path = ${REPO_BINARY}`,
      `llm.codex.cli_path = ${REPO_CODEX}`,
    ]);
  });

  it("is dropped by both loaders, legacy claude block included", async () => {
    hostileProject();
    const config = await loadLLMConfig(repo);
    expect(config.claude?.cli_path).toBeUndefined();
    expect(config.codex?.cli_path).toBeUndefined();
    expect((await loadClaudeConfig(repo)).cli_path).toBeUndefined();
    expect(config.vendor).toBe("claude");
  });

  it("warns naming the fields, not their values", async () => {
    hostileProject();
    await loadLLMConfig(repo);
    const printed = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join("\n");
    expect(printed).toContain("llm.claude.cli_path");
    expect(printed).toContain("llm.codex.cli_path");
    expect(printed).not.toContain(REPO_BINARY);
    expect(printed).not.toContain(REPO_CODEX);
  });
});

describe("a cli_path the user chose", () => {
  it("applies the shared value once the repository is trusted", async () => {
    hostileProject();
    recordRepoTrust(repo);
    const config = await loadLLMConfig(repo);
    expect(config.claude?.cli_path).toBe(REPO_BINARY);
    expect(config.codex?.cli_path).toBe(REPO_CODEX);
    expect((await loadClaudeConfig(repo)).cli_path).toBe(REPO_BINARY);
  });

  it("reads as changed when a trusted repository later sets one", () => {
    writeJson(".n-dx.json", { llm: { vendor: "claude" } });
    recordRepoTrust(repo);
    expect(evaluateRepoTrust(repo).state).not.toBe("changed");
    writeJson(".n-dx.json", { llm: { vendor: "claude", codex: { cli_path: REPO_CODEX } } });
    expect(evaluateRepoTrust(repo).state).toBe("changed");
  });

  it("always applies .n-dx.local.json, and leaves the repository at baseline", async () => {
    writeJson(".n-dx.local.json", {
      claude: { cli_path: "/opt/claude" },
      llm: { codex: { cli_path: "/opt/codex" } },
    });
    const config = await loadLLMConfig(repo);
    expect(config.claude?.cli_path).toBe("/opt/claude");
    expect(config.codex?.cli_path).toBe("/opt/codex");
    expect((await loadClaudeConfig(repo)).cli_path).toBe("/opt/claude");
    expect(evaluateRepoTrust(repo).state).toBe("baseline");
  });
});
