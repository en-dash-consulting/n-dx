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
import { GuardRails, credentialStorePattern } from "../../../src/guard/index.js";
import { GuardError, validatePath } from "../../../src/guard/paths.js";
import {
  DEFAULT_EXECUTION_POLICY,
  createPromptEnvelope,
  guardBaselineForLanguage,
} from "../../../src/prd/llm-gateway.js";
import { agentCredentialDenials, credentialStorePath, setCredential, setHelperCredential } from "@n-dx/llm-client";
import {
  buildClaudeCliArgs,
  buildDisallowedTools,
  claudeAbsolutePattern,
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

  /** The `--disallowed-tools` rules in `args`: one comma-joined value on Windows, one value each elsewhere. */
  function deniedRules(args: readonly string[], platform: NodeJS.Platform): string[] {
    const at = args.indexOf("--disallowed-tools") + 1;
    return platform === "win32" ? args[at].split(",") : args.slice(at, at + buildDisallowedTools().length);
  }

  it.each(["darwin", "win32"] as const)("the Claude CLI is denied edits to them (%s)", (platform) => {
    const denied = buildClaudeCliArgs({
      systemPrompt: "s",
      promptText: "p",
      allowedTools: ["Edit"],
      disallowedTools: buildDisallowedTools(),
    }, platform).args;
    const rules = deniedRules(denied, platform);
    for (const p of [".n-dx.json", ".n-dx.local.json", ".mcp.json", ".claude/**", ".codex/**"]) {
      expect(rules, p).toContain(`Edit(./${p})`);
    }
    // The adapter builds its arguments for the platform it runs on.
    const config = claudeCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {});
    expect(config.args).toContain("--disallowed-tools");
    expect(deniedRules(config.args, process.platform)).toEqual(buildDisallowedTools());
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

describe("the agent is kept out of the per-user credential store", () => {
  /** The `--disallowed-tools` rules in `args`: one comma-joined value on Windows, one value each elsewhere. */
  function deniedRules(args: readonly string[], platform: NodeJS.Platform, count: number): string[] {
    const at = args.indexOf("--disallowed-tools") + 1;
    return platform === "win32" ? args[at].split(",") : args.slice(at, at + count);
  }

  it.each([
    ["darwin", "/Users/me/.ndx/credentials.json", "//Users/me/.ndx/credentials.json"],
    ["linux", "/home/me/.ndx/credentials.json", "//home/me/.ndx/credentials.json"],
    ["win32", "C:\\Users\\me\\.ndx\\credentials.json", "//c/Users/me/.ndx/credentials.json"],
  ] as const)("the Claude CLI is denied reads and edits of the store (%s)", (platform, storePath, pattern) => {
    const disallowedTools = buildDisallowedTools({ storePath, platform });
    const { args } = buildClaudeCliArgs({ systemPrompt: "s", promptText: "p", allowedTools: ["Read"], disallowedTools }, platform);
    const rules = deniedRules(args, platform, disallowedTools.length);
    expect(rules).toContain(`Read(${pattern})`);
    expect(rules).toContain(`Edit(${pattern})`);
    expect(rules).toContain("Edit(./.n-dx.local.json)");
    if (platform === "win32") expect(args[args.indexOf("--disallowed-tools") + 1]).toBe(disallowedTools.join(","));
  });

  it("the spawn denies the store under the ndx home resolved at spawn time", () => {
    const previous = process.env.NDX_HOME;
    process.env.NDX_HOME = join(repo, "home-at-spawn");
    try {
      const config = claudeCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {});
      const expected = claudeAbsolutePattern(join(repo, "home-at-spawn", "credentials.json"));
      expect(config.args.join("\n")).toContain(`Read(${expected})`);
      expect(config.args.join("\n")).toContain(`Edit(${expected})`);
    } finally {
      if (previous === undefined) delete process.env.NDX_HOME;
      else process.env.NDX_HOME = previous;
    }
  });

  it("the guard refuses the store as an escape when the ndx home is outside the project", () => {
    const ndxHome = mkdtempSync(join(tmpdir(), "hench-ndx-home-"));
    try {
      const store = credentialStorePath({ ndxHome });
      const guard = new GuardRails(repo, DEFAULT_HENCH_CONFIG().guard, { shellKind: "posix", credentialDenials: { storePath: store, commandPrefixes: [] } });
      expect(() => guard.checkPath(store)).toThrow(/escapes project directory/);
      expect(credentialStorePattern(repo, store)).toEqual([]);
    } finally {
      rmSync(ndxHome, { recursive: true, force: true });
    }
  });

  it("the guard refuses the store, its lock and temp files when the ndx home is inside the project", () => {
    const store = credentialStorePath({ ndxHome: join(repo, "tools", "ndx-home") });
    const guard = new GuardRails(repo, { ...DEFAULT_HENCH_CONFIG().guard, blockedPaths: [] }, { shellKind: "posix", credentialDenials: { storePath: store, commandPrefixes: [] } });
    for (const p of [store, "tools/ndx-home/credentials.json", "tools/ndx-home/credentials.json.lock", "tools/ndx-home/credentials.json.1.x.tmp", "TOOLS/ndx-home/Credentials.json"]) {
      expect(() => guard.checkPath(p), p).toThrow(/blocked pattern/);
    }
    expect(() => guard.checkPath("tools/ndx-home/hub.json")).not.toThrow();
  });

  it("no stored value reaches a child environment", () => {
    const ndxHome = mkdtempSync(join(tmpdir(), "hench-ndx-home-"));
    try {
      setCredential("typesafe", "tsk_placeholder_stored_value", { ndxHome });
      const env = { ...FAKE_CREDENTIALS, NDX_HOME: ndxHome };
      const guard = new GuardRails(repo, DEFAULT_HENCH_CONFIG().guard, { env, shellKind: "posix" });
      expect(Object.values(guard.childEnv)).not.toContain("tsk_placeholder_stored_value");
      const config = claudeCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {});
      expect(Object.values(config.env)).not.toContain("tsk_placeholder_stored_value");
      expect(config.args.join("\n")).not.toContain("tsk_placeholder_stored_value");
    } finally {
      rmSync(ndxHome, { recursive: true, force: true });
    }
  });
});

describe("the agent may not run a command that reads a stored credential", () => {
  let ndxHome: string;
  beforeEach(() => {
    ndxHome = mkdtempSync(join(tmpdir(), "hench-ndx-home-"));
    setHelperCredential("typesafe", ["/opt/homebrew/bin/op", "read", "op://vault/item/field"], { ndxHome });
    setHelperCredential("claude", ["C:\\Tools\\bw.exe", "get", "password", "x"], { ndxHome });
  });
  afterEach(() => rmSync(ndxHome, { recursive: true, force: true }));

  /** A guard whose allowlist names every denied program, as a user who widened it would. */
  function widenedGuard(): GuardRails {
    const base = DEFAULT_HENCH_CONFIG().guard;
    const allowedCommands = [...base.allowedCommands, "security", "op", "bw", "node"];
    return new GuardRails(repo, { ...base, allowedCommands }, {
      shellKind: "posix",
      credentialDenials: agentCredentialDenials({ ndxHome }),
    });
  }

  it.each([
    "security find-generic-password -s ndx -w",
    "/usr/bin/security find-generic-password -w",
    // A global option before the subcommand, or an escape sh strips, still names it.
    "security -q find-generic-password -s X -w",
    "security -v -q find-generic-password -w",
    "security find\\-generic-password -s X -w",
    "security 'find-generic'-password -w",
    "security \"find-generic-password\" -w",
    "secur\\ity find-generic-password -w",
    "op read op://vault/item/field",
    "/opt/homebrew/bin/op read x",
    "'/opt/homebrew/bin/op' item list",
    "bw get password x",
    "bw.exe get password x",
    "BW.EXE list items",
  ])("refuses %j even when guard.allowedCommands lists it", (command) => {
    expect(() => widenedGuard().checkCommand(command)).toThrow(/reads a stored credential/);
  });

  it("still allows other subcommands of security and other allowed commands", () => {
    const guard = widenedGuard();
    expect(() => guard.checkCommand("security list-keychains")).not.toThrow();
    expect(() => guard.checkCommand("security -q find-certificate -c x")).not.toThrow();
    expect(() => guard.checkCommand("security find-internet-password -s x")).not.toThrow();
    // Inside double quotes sh keeps a backslash before `-`, so this is not the subcommand.
    expect(() => guard.checkCommand("security \"find\\-generic-password\"")).not.toThrow();
    expect(() => guard.checkCommand("npm test")).not.toThrow();
    // The documented gap: an allowed interpreter is not a command this list can see.
    expect(() => guard.checkCommand("node -e 'process.exit(0)'")).not.toThrow();
  });

  it.each(["darwin", "linux", "win32"] as const)("the Claude CLI denies them as Bash rules beside the store rules (%s)", (platform) => {
    const { storePath, commandPrefixes } = agentCredentialDenials({ ndxHome });
    const disallowedTools = buildDisallowedTools({ storePath, commandPrefixes, platform });
    const { args } = buildClaudeCliArgs({ systemPrompt: "s", promptText: "p", allowedTools: ["Bash"], disallowedTools }, platform);
    const at = args.indexOf("--disallowed-tools") + 1;
    const rules = platform === "win32" ? args[at]!.split(",") : args.slice(at, at + disallowedTools.length);
    const store = claudeAbsolutePattern(storePath, platform);
    expect(rules).toEqual(expect.arrayContaining([
      `Read(${store})`,
      `Edit(${store})`,
      "Bash(security find-generic-password:*)",
      "Bash(/opt/homebrew/bin/op:*)",
      "Bash(op:*)",
      "Bash(C:\\Tools\\bw.exe:*)",
      "Bash(bw.exe:*)",
      "Bash(bw:*)",
    ]));
    expect(rules).toHaveLength(disallowedTools.length);
  });

  describe("an interpreter helper", () => {
    beforeEach(() => {
      setHelperCredential("google", ["node", "/x/get-key.mjs"], { ndxHome });
    });

    it("refuses its script and still allows the interpreter", () => {
      const guard = widenedGuard();
      expect(() => guard.checkCommand("node /x/get-key.mjs")).toThrow(/reads a stored credential/);
      expect(() => guard.checkCommand("/usr/local/bin/node /x/get-key.mjs --vault v")).toThrow(/reads a stored credential/);
      expect(() => guard.checkCommand("node -e 1")).not.toThrow();
      expect(() => guard.checkCommand("node scripts/build.mjs")).not.toThrow();
    });

    it.each(["darwin", "linux", "win32"] as const)("the Claude CLI denies the script, not bare node (%s)", (platform) => {
      const { storePath, commandPrefixes } = agentCredentialDenials({ ndxHome });
      const disallowedTools = buildDisallowedTools({ storePath, commandPrefixes, platform });
      const { args } = buildClaudeCliArgs({ systemPrompt: "s", promptText: "p", allowedTools: ["Bash"], disallowedTools }, platform);
      const at = args.indexOf("--disallowed-tools") + 1;
      const rules = platform === "win32" ? args[at]!.split(",") : args.slice(at, at + disallowedTools.length);
      expect(rules).toContain("Bash(node /x/get-key.mjs:*)");
      expect(rules).not.toContain("Bash(node:*)");
      expect(rules).toHaveLength(disallowedTools.length);
    });
  });

  // An agent must quote a path with a space to run it, and Claude's prefix match
  // is on the literal command, so the unquoted rule alone never matches.
  describe("a helper path with a space", () => {
    function deniedRules(platform: NodeJS.Platform): string[] {
      const { storePath, commandPrefixes } = agentCredentialDenials({ ndxHome });
      const disallowedTools = buildDisallowedTools({ storePath, commandPrefixes, platform });
      const { args } = buildClaudeCliArgs({ systemPrompt: "s", promptText: "p", allowedTools: ["Bash"], disallowedTools }, platform);
      const at = args.indexOf("--disallowed-tools") + 1;
      const rules = platform === "win32" ? args[at]!.split(",") : args.slice(at, at + disallowedTools.length);
      expect(rules).toHaveLength(disallowedTools.length);
      return rules;
    }

    it.each(["darwin", "linux", "win32"] as const)("denies the quoted spellings of an interpreter's script (%s)", (platform) => {
      setHelperCredential("google", ["node", "/x/my dir/get-key.mjs"], { ndxHome });
      expect(deniedRules(platform)).toEqual(expect.arrayContaining([
        "Bash(node /x/my dir/get-key.mjs:*)",
        `Bash(node "/x/my dir/get-key.mjs":*)`,
        "Bash(node '/x/my dir/get-key.mjs':*)",
      ]));
    });

    it.each(["darwin", "linux", "win32"] as const)("denies the quoted spellings of a command whose argv[0] has a space (%s)", (platform) => {
      setHelperCredential("google", ["/Applications/My Tools/op", "read", "x"], { ndxHome });
      expect(deniedRules(platform)).toEqual(expect.arrayContaining([
        "Bash(/Applications/My Tools/op:*)",
        `Bash("/Applications/My Tools/op":*)`,
        "Bash('/Applications/My Tools/op':*)",
      ]));
    });

    it("adds no quoted spelling when no token has a space", () => {
      expect(buildDisallowedTools({ storePath: "/s", commandPrefixes: [["node", "/x/get-key.mjs"]], platform: "linux" }))
        .toEqual(expect.not.arrayContaining([expect.stringMatching(/["']/)]));
    });
  });

  it("the spawn reads the helpers stored in the ndx home at spawn time", () => {
    const previous = process.env.NDX_HOME;
    process.env.NDX_HOME = ndxHome;
    try {
      const config = claudeCliAdapter.buildSpawnConfig(createPromptEnvelope([]), DEFAULT_EXECUTION_POLICY, {});
      expect(config.args.join("\n")).toContain("Bash(op:*)");
      expect(config.args.join("\n")).toContain("Bash(security find-generic-password:*)");
    } finally {
      if (previous === undefined) delete process.env.NDX_HOME;
      else process.env.NDX_HOME = previous;
    }
  });
});
