/**
 * The repository trust digest covers every tracked input that can widen
 * execution: hench's run posture and binary/credential keys, the project
 * config's llm.* binaries and endpoints and web.auth, the assistants' own
 * project files, and every `run` block saved on a PRD item. Each one is
 * reported as a warning when it widens, and changing any of them moves a
 * trusted checkout to `changed`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assessRepoExecutionConfig,
  collectRepoExecutionConfig,
  evaluateRepoTrust,
  isRepoRestricted,
  recordRepoTrust,
  scanFrontMatterRunBlock,
} from "../../src/repo-trust.js";

let repo: string;
let home: string;

function write(rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(rel: string, data: unknown): void {
  write(rel, JSON.stringify(data, null, 2));
}

function codes(): string[] {
  return assessRepoExecutionConfig(collectRepoExecutionConfig(repo)).map((f) => f.code);
}

function finding(code: string) {
  return assessRepoExecutionConfig(collectRepoExecutionConfig(repo)).find((f) => f.code === code);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ndx-trust-digest-repo-"));
  home = mkdtempSync(join(tmpdir(), "ndx-trust-digest-home-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("hench run posture", () => {
  it("warns on autonomous, autoCommit and skipFullTestGate", () => {
    writeJson(".hench/config.json", { autonomous: true, autoCommit: true, skipFullTestGate: true });
    const f = finding("run-posture");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual(["autonomous", "autoCommit", "skipFullTestGate"]);
  });

  it("is silent when they are off or absent", () => {
    writeJson(".hench/config.json", { autonomous: false, autoCommit: false });
    expect(codes()).not.toContain("run-posture");
  });

  it("reads them from the project config's hench override too", () => {
    writeJson(".n-dx.json", { hench: { autoCommit: true } });
    expect(finding("run-posture")?.values).toEqual(["autoCommit"]);
  });
});

describe("api key variable", () => {
  it("accepts a variable named like an API key", () => {
    writeJson(".hench/config.json", { apiKeyEnv: "ANTHROPIC_API_KEY" });
    expect(codes()).not.toContain("api-key-env");
    expect(collectRepoExecutionConfig(repo).posture.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });

  it("warns on hench.apiKeyEnv and llm.google.apiKeyEnv that name anything else", () => {
    writeJson(".hench/config.json", { apiKeyEnv: "GITHUB_TOKEN" });
    writeJson(".n-dx.json", { llm: { google: { apiKeyEnv: "AWS_SECRET_ACCESS_KEY" } } });
    const f = finding("api-key-env");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual(["hench.apiKeyEnv=GITHUB_TOKEN", "llm.google.apiKeyEnv=AWS_SECRET_ACCESS_KEY"]);
  });
});

describe("vendor CLI binary", () => {
  it("warns on hench.claudePath and every llm.<vendor>.cli_path, legacy claude.cli_path included", () => {
    writeJson(".hench/config.json", { claudePath: "./node_modules/.bin/claude" });
    writeJson(".n-dx.json", { llm: { codex: { cli_path: "/opt/codex" } }, claude: { cli_path: "./tools/claude" } });
    const f = finding("cli-path");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual([
      "hench.claudePath=./node_modules/.bin/claude",
      "llm.claude.cli_path=./tools/claude",
      "llm.codex.cli_path=/opt/codex",
    ]);
  });

  it("does not warn on the bare vendor command, which PATH resolves", () => {
    writeJson(".hench/config.json", { claudePath: "claude" });
    writeJson(".n-dx.json", { llm: { codex: { cli_path: "codex" } } });
    expect(codes()).not.toContain("cli-path");
  });
});

describe("API endpoints", () => {
  it("warns on llm.<vendor>.api_endpoint and a non-loopback llm.local.host", () => {
    writeJson(".n-dx.json", {
      llm: {
        claude: { api_endpoint: "https://proxy.example/anthropic" },
        local: { host: "models.example", port: 8080 },
      },
    });
    const f = finding("api-endpoint");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual(["llm.claude.api_endpoint=https://proxy.example/anthropic", "llm.local.host=models.example"]);
  });

  it("does not warn on a loopback local host, but keeps the port in the digest", () => {
    writeJson(".n-dx.json", { llm: { local: { host: "127.0.0.1", port: 1234 } } });
    expect(codes()).not.toContain("api-endpoint");
    const before = collectRepoExecutionConfig(repo).digest;
    writeJson(".n-dx.json", { llm: { local: { host: "127.0.0.1", port: 4321 } } });
    expect(collectRepoExecutionConfig(repo).digest).not.toBe(before);
  });

  it("reviews a verifier destination and invalidates acceptance when it changes", () => {
    writeJson(".n-dx.json", { llm: { local: { verifier: { host: "review.example", port: 1234 } } } });
    expect(finding("api-endpoint")?.values).toContain("llm.local.verifier.host=review.example");
    recordRepoTrust(repo, { ndxHome: home });
    writeJson(".n-dx.json", { llm: { local: { verifier: { host: "other.example", port: 1234 } } } });
    expect(evaluateRepoTrust(repo, { ndxHome: home }).state).toBe("changed");
  });
});

describe("web.auth", () => {
  it("warns when the project config turns the dashboard token off", () => {
    writeJson(".n-dx.json", { web: { auth: false } });
    expect(finding("web-auth-disabled")?.severity).toBe("warning");
    expect(collectRepoExecutionConfig(repo).webAuthDisabled).toBe(true);
  });

  it("is silent when auth is on", () => {
    writeJson(".n-dx.json", { web: { auth: true, port: 3117 } });
    expect(codes()).not.toContain("web-auth-disabled");
  });
});

describe("assistant project files", () => {
  it("warns on .claude/settings.json grants and lists what they are", () => {
    writeJson(".claude/settings.json", {
      permissions: { allow: ["Bash(rm:*)", "WebFetch"], defaultMode: "bypassPermissions" },
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "./x.sh" }] }] },
      env: { HTTP_PROXY: "http://proxy.example" },
    });
    const f = finding("assistant-settings");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual(["Bash(rm:*)", "WebFetch", "defaultMode=bypassPermissions", "hooks", "env.HTTP_PROXY"]);
    expect(f?.message).toContain("2 permissions.allow entries");
    expect(collectRepoExecutionConfig(repo).sources).toContain(".claude/settings.json");
  });

  it("does not warn on a settings file that grants nothing, but digests it", () => {
    writeJson(".claude/settings.json", { permissions: { deny: ["Bash(rm:*)"] } });
    expect(codes()).not.toContain("assistant-settings");
    expect(collectRepoExecutionConfig(repo).assistantFiles.map((f) => f.path)).toEqual([".claude/settings.json"]);
  });

  it("warns on hook files and the Codex project config, by content hash", () => {
    write(".claude/hooks/pre-tool.sh", "#!/bin/sh\necho hi\n");
    write(".claude/hooks/nested/post.sh", "#!/bin/sh\n");
    write(".codex/config.toml", 'approval_policy = "never"\n');
    const f = finding("assistant-hooks");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual([".claude/hooks/nested/post.sh", ".claude/hooks/pre-tool.sh", ".codex/config.toml"]);
    const files = collectRepoExecutionConfig(repo).assistantFiles;
    expect(files).toHaveLength(3);
    for (const file of files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("PRD run blocks", () => {
  const ITEM = (run: string) => `---\nid: "a"\ntype: "change"\ntitle: "T"\nrun: ${run}\n---\nBody mentions run: not front matter\n`;

  it("scans front matter for an inline JSON run block", () => {
    expect(scanFrontMatterRunBlock(ITEM('{"tier":"light"}'))).toEqual({ tier: "light" });
    expect(scanFrontMatterRunBlock("---\nid: x\n---\nrun: {\"tier\":\"light\"}\n")).toBeUndefined();
    expect(scanFrontMatterRunBlock("no front matter\nrun: {}\n")).toBeUndefined();
  });

  it("keeps a block it cannot parse as raw text, inline or indented", () => {
    expect(scanFrontMatterRunBlock(ITEM("not json"))).toBe("not json");
    expect(scanFrontMatterRunBlock("---\nrun:\n  tier: light\n  review: true\n---\n")).toBe("  tier: light\n  review: true");
  });

  it("collects every block under changes/, prd_tree/ and product/ in path order", () => {
    write(".rex/changes/inbox/b/index.md", ITEM('{"tier":"light"}'));
    write(".rex/prd_tree/epic/feature/task/index.md", ITEM('{"maxTurns":5}'));
    write(".rex/product/cap/index.md", ITEM('{"review":true}'));
    write(".rex/changes/inbox/plain/index.md", "---\nid: p\n---\n");
    const blocks = collectRepoExecutionConfig(repo).prdRunBlocks;
    expect(blocks).toEqual([
      { path: ".rex/changes/inbox/b/index.md", run: { tier: "light" } },
      { path: ".rex/prd_tree/epic/feature/task/index.md", run: { maxTurns: 5 } },
      { path: ".rex/product/cap/index.md", run: { review: true } },
    ]);
    expect(collectRepoExecutionConfig(repo).sources).toContain(".rex/product/cap/index.md");
  });

  it("warns only on blocks that set execution posture", () => {
    write(".rex/changes/inbox/model/index.md", ITEM('{"tier":"heavy","models":{"claude":"x"}}'));
    expect(codes()).not.toContain("run-settings");

    write(".rex/changes/inbox/posture/index.md", ITEM('{"permissionMode":"acceptEdits","skipTestGate":true,"tokenBudget":0}'));
    const f = finding("run-settings");
    expect(f?.severity).toBe("warning");
    expect(f?.values).toEqual([".rex/changes/inbox/posture/index.md: permissionMode=acceptEdits, skipTestGate=true, tokenBudget=0"]);
  });
});

describe("digest movement", () => {
  const BASE_HENCH = { guard: { allowedCommands: ["npm", "git", "bash"], blockedPaths: [".hench/**", ".rex/**", ".git/**", ".env"], allowedGitSubcommands: ["status"] } };

  /** Every digested input, as a mutation of a trusted checkout. */
  const MUTATIONS: Array<[string, () => void]> = [
    ["hench.autonomous", () => writeJson(".hench/config.json", { ...BASE_HENCH, autonomous: true })],
    ["hench.autoCommit", () => writeJson(".hench/config.json", { ...BASE_HENCH, autoCommit: true })],
    ["hench.skipFullTestGate", () => writeJson(".hench/config.json", { ...BASE_HENCH, skipFullTestGate: true })],
    ["hench.apiKeyEnv", () => writeJson(".hench/config.json", { ...BASE_HENCH, apiKeyEnv: "OTHER_API_KEY" })],
    ["hench.claudePath", () => writeJson(".hench/config.json", { ...BASE_HENCH, claudePath: "/opt/claude" })],
    ["llm.claude.cli_path", () => writeJson(".n-dx.json", { llm: { claude: { cli_path: "/opt/claude" } } })],
    ["legacy claude.api_endpoint", () => writeJson(".n-dx.json", { claude: { api_endpoint: "https://x.example" } })],
    ["llm.codex.api_endpoint", () => writeJson(".n-dx.json", { llm: { codex: { api_endpoint: "https://x.example" } } })],
    ["llm.local.host", () => writeJson(".n-dx.json", { llm: { local: { host: "localhost" } } })],
    ["llm.local.port", () => writeJson(".n-dx.json", { llm: { local: { port: 9999 } } })],
    ["llm.google.apiKeyEnv", () => writeJson(".n-dx.json", { llm: { google: { apiKeyEnv: "GEMINI_API_KEY" } } })],
    ["web.auth", () => writeJson(".n-dx.json", { web: { auth: false } })],
    [".claude/settings.json", () => writeJson(".claude/settings.json", { permissions: { allow: ["Read"] } })],
    [".claude/hooks/*", () => write(".claude/hooks/a.sh", "echo\n")],
    [".codex/config.toml", () => write(".codex/config.toml", "x = 1\n")],
    ["a PRD run block", () => write(".rex/changes/inbox/c/index.md", '---\nid: c\nrun: {"tier":"light"}\n---\n')],
  ];

  for (const [name, mutate] of MUTATIONS) {
    it(`moves a trusted checkout to changed when ${name} changes`, () => {
      // Deviating (bash is not in the baseline) and then trusted.
      writeJson(".hench/config.json", BASE_HENCH);
      recordRepoTrust(repo, { ndxHome: home });
      expect(evaluateRepoTrust(repo, { ndxHome: home }).state).toBe("trusted");
      expect(isRepoRestricted(repo, { ndxHome: home })).toBe(false);

      mutate();
      const after = evaluateRepoTrust(repo, { ndxHome: home });
      expect(after.state, name).toBe("changed");
      expect(after.restricted).toBe(true);
      expect(isRepoRestricted(repo, { ndxHome: home })).toBe(true);
    });
  }

  it("keeps the digest a checkout without any of the new inputs already had", () => {
    writeJson(".hench/config.json", BASE_HENCH);
    const config = collectRepoExecutionConfig(repo);
    // Keys enter the body only when set, so none of the new ones appear here.
    expect(config.posture).toEqual({ autonomous: null, autoCommit: null, skipFullTestGate: null, apiKeyEnv: null, claudePath: null });
    expect(config.assistantFiles).toEqual([]);
    expect(config.prdRunBlocks).toEqual([]);
    expect(config.webAuthDisabled).toBe(false);
  });
});
