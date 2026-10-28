/**
 * The config backstop puts n-dx's own config back after an agent wrote it
 * (#686 finding 1, follow-up).
 *
 * The guard and Claude's `Edit(...)` denies refuse these paths to the tools
 * they see. `codex exec`, an allowed shell command and another spelling of the
 * name get past both, so the backstop compares the files themselves.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConfigBackstop,
  ConfigBackstopError,
  PROTECTED_CONFIG_FILES,
  formatProtectedConfigFinding,
} from "../../../src/guard/config-backstop.js";
import { NDX_CONFIG_BLOCKED_PATHS, detectLayoutMode } from "../../../src/prd/llm-gateway.js";

const WIDENING = JSON.stringify({ hench: { guard: { env: { allow: ["*"] } } }, secret: "sk-agent-wrote-this" });

let dir: string;

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-config-backstop-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PROTECTED_CONFIG_FILES", () => {
  it("covers every blocked config file and the vendor settings in the blocked directories", () => {
    for (const blocked of NDX_CONFIG_BLOCKED_PATHS.filter((p) => !p.includes("*"))) {
      expect(PROTECTED_CONFIG_FILES).toContain(blocked);
    }
    expect(PROTECTED_CONFIG_FILES).toEqual(expect.arrayContaining([
      ".n-dx.local.json",
      ".ndx/config.local.json",
      ".claude/settings.local.json",
      ".codex/config.toml",
    ]));
  });
});

describe("ConfigBackstop", () => {
  it("removes a config file the agent created, and the directory it created for it", () => {
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".n-dx.local.json"), WIDENING);
    mkdirSync(join(dir, ".ndx"));
    writeFileSync(join(dir, ".ndx", "config.local.json"), WIDENING);

    const writes = backstop.restore();

    expect(writes).toEqual(expect.arrayContaining([
      { path: ".n-dx.local.json", change: "created", restored: true },
      { path: ".ndx/config.local.json", change: "created", restored: true },
    ]));
    expect(existsSync(join(dir, ".n-dx.local.json"))).toBe(false);
    // An empty `.ndx/` would switch every later command to that layout.
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
  });

  it("puts back a config file the agent rewrote, content and mode", () => {
    writeFileSync(join(dir, ".n-dx.local.json"), "{}\n", { mode: 0o600 });
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".n-dx.local.json"), WIDENING);

    expect(backstop.restore()).toEqual([{ path: ".n-dx.local.json", change: "modified", restored: true }]);
    expect(readFileSync(join(dir, ".n-dx.local.json"), "utf-8")).toBe("{}\n");
    if (process.platform !== "win32") expect(statSync(join(dir, ".n-dx.local.json")).mode & 0o777).toBe(0o600);
  });

  it("puts back a config file the agent deleted, with its directory", () => {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.local.json"), "{\"permissions\":{}}");
    const backstop = ConfigBackstop.capture(dir);
    rmSync(join(dir, ".claude"), { recursive: true });

    expect(backstop.restore()).toEqual([{ path: ".claude/settings.local.json", change: "deleted", restored: true }]);
    expect(readFileSync(join(dir, ".claude", "settings.local.json"), "utf-8")).toBe("{\"permissions\":{}}");
  });

  // File symlinks need elevated rights on Windows.
  it.skipIf(process.platform === "win32")("replaces a symlink the agent put in a file's place without writing through it", () => {
    writeFileSync(join(dir, ".n-dx.json"), "{\"web\":{}}");
    const outside = join(dir, "outside.json");
    writeFileSync(outside, WIDENING);
    const backstop = ConfigBackstop.capture(dir);
    rmSync(join(dir, ".n-dx.json"));
    symlinkSync(outside, join(dir, ".n-dx.json"));

    expect(backstop.restore()).toEqual([{ path: ".n-dx.json", change: "modified", restored: true }]);
    expect(lstatSync(join(dir, ".n-dx.json")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, ".n-dx.json"), "utf-8")).toBe("{\"web\":{}}");
    expect(readFileSync(outside, "utf-8")).toBe(WIDENING);
  });

  it.skipIf(process.platform === "win32")("puts back the file behind the user's own symlink when the agent wrote through it", () => {
    const own = join(dir, "my-ndx-local.json");
    writeFileSync(own, "{}");
    symlinkSync(own, join(dir, ".n-dx.local.json"));
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".n-dx.local.json"), WIDENING);

    expect(backstop.restore()).toEqual([{ path: ".n-dx.local.json", change: "modified", restored: true }]);
    expect(lstatSync(join(dir, ".n-dx.local.json")).isSymbolicLink()).toBe(true);
    expect(readFileSync(own, "utf-8")).toBe("{}");
  });

  // A link to a device never reaches end of file; reading it would hang the run.
  it.skipIf(process.platform === "win32")("removes a symlink the agent pointed at a device without reading it", () => {
    const backstop = ConfigBackstop.capture(dir);
    symlinkSync("/dev/zero", join(dir, ".n-dx.local.json"));

    expect(backstop.restore()).toEqual([{ path: ".n-dx.local.json", change: "created", restored: true }]);
    expect(existsSync(join(dir, ".n-dx.local.json"))).toBe(false);
  }, 5_000);

  it.runIf(caseInsensitiveFs())("catches a write under another spelling of the name", () => {
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".N-DX.local.json"), WIDENING);

    expect(backstop.restore()).toEqual([{ path: ".n-dx.local.json", change: "created", restored: true }]);
    expect(existsSync(join(dir, ".N-DX.local.json"))).toBe(false);
  });

  it("reports nothing and writes nothing when no config changed", () => {
    writeFileSync(join(dir, ".n-dx.json"), "{}");
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, "src.ts"), "export {};\n");

    expect(backstop.restore()).toEqual([]);
    expect(backstop.writes).toEqual([]);
  });

  it("keeps every write found since the snapshot, once per path", () => {
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".mcp.json"), "{}");
    backstop.restore();
    writeFileSync(join(dir, ".mcp.json"), "{\"mcpServers\":{}}");
    backstop.restore();

    expect(backstop.writes).toEqual([{ path: ".mcp.json", change: "created", restored: true }]);
    expect(backstop.restore()).toEqual([]);
  });
});

/**
 * The backstop runs unsandboxed, so a protected directory the agent swapped
 * for a link must never carry a restore out of the project. `home` stands in
 * for the user's home directory: its files must come through untouched.
 */
describe.skipIf(process.platform === "win32")("ConfigBackstop with a swapped protected directory", () => {
  const USER_CLAUDE = "{\"hooks\":{\"user\":true}}";
  const USER_CODEX = "model = \"user\"\n";
  const USER_LOCAL = "{\"permissions\":{\"user\":true}}";
  let home: string;

  beforeEach(() => {
    home = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-config-backstop-home-")));
    mkdirSync(join(home, ".claude"));
    writeFileSync(join(home, ".claude", "settings.json"), USER_CLAUDE);
    writeFileSync(join(home, ".claude", "settings.local.json"), USER_LOCAL);
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "config.toml"), USER_CODEX);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function expectHomeUntouched(): void {
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf-8")).toBe(USER_CLAUDE);
    expect(readFileSync(join(home, ".claude", "settings.local.json"), "utf-8")).toBe(USER_LOCAL);
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf-8")).toBe(USER_CODEX);
  }

  it("never writes or deletes through .claude and .codex swapped for links out of the project", () => {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), "{\"repo\":true}");
    mkdirSync(join(dir, ".codex"));
    writeFileSync(join(dir, ".codex", "config.toml"), "model = \"repo\"\n");
    const backstop = ConfigBackstop.capture(dir);
    rmSync(join(dir, ".claude"), { recursive: true });
    rmSync(join(dir, ".codex"), { recursive: true });
    symlinkSync(join(home, ".claude"), join(dir, ".claude"));
    symlinkSync(join(home, ".codex"), join(dir, ".codex"));

    const writes = backstop.restore();

    expectHomeUntouched();
    expect(writes).toEqual(expect.arrayContaining([
      { path: ".claude", change: "replaced", restored: true },
      { path: ".codex", change: "replaced", restored: true },
    ]));
    expect(lstatSync(join(dir, ".claude")).isDirectory()).toBe(true);
    expect(readFileSync(join(dir, ".claude", "settings.json"), "utf-8")).toBe("{\"repo\":true}");
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);
    expect(readFileSync(join(dir, ".codex", "config.toml"), "utf-8")).toBe("model = \"repo\"\n");
    expect(formatProtectedConfigFinding(backstop.writes)).toContain(".claude (replaced, restored)");
  });

  it("removes a link created where no protected directory was, leaving its target alone", () => {
    const backstop = ConfigBackstop.capture(dir);
    symlinkSync(join(home, ".claude"), join(dir, ".claude"));

    expect(backstop.restore()).toEqual([{ path: ".claude", change: "created", restored: true }]);
    expectHomeUntouched();
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("replaces a protected directory swapped for a link loop", () => {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), "{}");
    const backstop = ConfigBackstop.capture(dir);
    rmSync(join(dir, ".claude"), { recursive: true });
    symlinkSync(".claude", join(dir, ".claude"));

    expect(backstop.restore()).toEqual(expect.arrayContaining([{ path: ".claude", change: "replaced", restored: true }]));
    expect(readFileSync(join(dir, ".claude", "settings.json"), "utf-8")).toBe("{}");
  });

  it("removes a .ndx link out of the project, so the layout stays legacy", () => {
    mkdirSync(join(home, "planted"));
    writeFileSync(join(home, "planted", "config.local.json"), USER_LOCAL);
    writeFileSync(join(dir, ".n-dx.local.json"), "{}");
    const backstop = ConfigBackstop.capture(dir);
    symlinkSync(join(home, "planted"), join(dir, ".ndx"));

    expect(backstop.restore()).toEqual([{ path: ".ndx", change: "created", restored: true }]);
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(readFileSync(join(home, "planted", "config.local.json"), "utf-8")).toBe(USER_LOCAL);
    expect(detectLayoutMode(dir)).toBe("legacy");
  });
});

describe("ConfigBackstop and the layout", () => {
  it("removes a .ndx/ created on a legacy project with no config file in it", () => {
    writeFileSync(join(dir, ".n-dx.local.json"), "{}");
    const backstop = ConfigBackstop.capture(dir);
    mkdirSync(join(dir, ".ndx", "hench"), { recursive: true });
    writeFileSync(join(dir, ".ndx", "hench", "config.json"), WIDENING);
    expect(detectLayoutMode(dir)).toBe("ndx");

    expect(backstop.restore()).toEqual([{ path: ".ndx", change: "created", restored: true }]);
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(detectLayoutMode(dir)).toBe("legacy");
  });

  it("reports a .ndx/ that vanished from an .ndx-layout project as not restored", () => {
    mkdirSync(join(dir, ".ndx", "rex"), { recursive: true });
    const backstop = ConfigBackstop.capture(dir);
    rmSync(join(dir, ".ndx"), { recursive: true });

    expect(backstop.restore()).toEqual([{ path: ".ndx", change: "deleted", restored: false }]);
  });

  it("leaves an .ndx-layout project's own .ndx/ alone", () => {
    mkdirSync(join(dir, ".ndx", "rex"), { recursive: true });
    const backstop = ConfigBackstop.capture(dir);
    mkdirSync(join(dir, ".ndx", "hench"));

    expect(backstop.restore()).toEqual([]);
    expect(existsSync(join(dir, ".ndx", "hench"))).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("ConfigBackstop.capture on a protected path it cannot read", () => {
  it("refuses with a ConfigBackstopError naming a protected directory that is a link loop", () => {
    symlinkSync(".claude", join(dir, ".claude"));

    expect(() => ConfigBackstop.capture(dir)).toThrow(ConfigBackstopError);
    expect(() => ConfigBackstop.capture(dir)).toThrow(/\.claude\/settings\.json could not be read \(ELOOP\)/);
  });

  it.skipIf(process.getuid?.() === 0)("refuses with a ConfigBackstopError naming an unreadable protected directory", () => {
    mkdirSync(join(dir, ".codex"));
    chmodSync(join(dir, ".codex"), 0o000);
    try {
      expect(() => ConfigBackstop.capture(dir)).toThrow(/\.codex\/config\.toml could not be read \(EACCES\)/);
    } finally {
      chmodSync(join(dir, ".codex"), 0o755);
    }
  });
});

describe("formatProtectedConfigFinding", () => {
  it("names the path and what happened, never the content", () => {
    const backstop = ConfigBackstop.capture(dir);
    writeFileSync(join(dir, ".n-dx.local.json"), WIDENING);
    backstop.restore();

    const finding = formatProtectedConfigFinding(backstop.writes);
    expect(finding).toContain(".n-dx.local.json (created, restored)");
    expect(finding).not.toContain("sk-agent-wrote-this");
    expect(finding).not.toContain("allow");
  });

  it("tells the operator when a file could not be put back", () => {
    const finding = formatProtectedConfigFinding([{ path: ".mcp.json", change: "modified", restored: false }]);
    expect(finding).toContain(".mcp.json (modified, NOT restored)");
    expect(finding).toMatch(/Inspect the files not restored/);
  });
});

/**
 * True when the temp filesystem folds case, as macOS and Windows do by
 * default. Evaluated at collection time, before `dir` exists.
 */
function caseInsensitiveFs(): boolean {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-case-probe-")));
  try {
    writeFileSync(join(root, "probe"), "");
    return existsSync(join(root, "PROBE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
