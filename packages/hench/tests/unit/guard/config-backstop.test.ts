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
  PROTECTED_CONFIG_FILES,
  formatProtectedConfigFinding,
} from "../../../src/guard/config-backstop.js";
import { NDX_CONFIG_BLOCKED_PATHS } from "../../../src/prd/llm-gateway.js";

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
