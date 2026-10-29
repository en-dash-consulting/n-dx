import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  GuardRails,
  assertSandboxReady,
  createToolSandbox,
  createVendorCliSandbox,
  formatSandboxPosture,
  resolveSandboxPosture,
} from "../../../src/guard/index.js";
import type { ToolSandbox } from "../../../src/guard/index.js";
import { guardDefaultsForLanguage } from "../../../src/schema/v1.js";
import { toolRunCommand } from "../../../src/tools/shell.js";
import { detectSandboxBackend } from "../../../src/prd/llm-gateway.js";

const seatbelt = { name: "seatbelt" as const, available: true };
const missing = { name: "bwrap" as const, available: false, reason: "bwrap is not on PATH" };
const on = { mode: "on" as const, toolNetwork: "none" as const, source: "default" as const };
const off = { mode: "off" as const, toolNetwork: "none" as const, source: "local-config" as const };

const made: string[] = [];
function tempProject(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hench-sbx-test-")));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolveSandboxPosture", () => {
  it("is confined when the setting is on and the backend is usable", () => {
    expect(resolveSandboxPosture("/p", { setting: on, backend: seatbelt }).posture).toEqual({
      state: "confined", backend: "seatbelt", network: "none", source: "default",
    });
  });
  it("is off when the operator turned it off, whatever the backend", () => {
    expect(resolveSandboxPosture("/p", { setting: off, backend: seatbelt }).posture.state).toBe("off");
  });
  it("is unavailable, with the backend's reason, when nothing can confine", () => {
    expect(resolveSandboxPosture("/p", { setting: on, backend: missing }).posture).toMatchObject({
      state: "unavailable", reason: "bwrap is not on PATH",
    });
  });
});

describe("assertSandboxReady", () => {
  const unavailable = resolveSandboxPosture("/p", { setting: on, backend: missing }).posture;
  it("refuses an autonomous run that would run unconfined, naming the opt-out", () => {
    expect(() => assertSandboxReady(unavailable, true)).toThrow(/NDX_SANDBOX=off/);
  });
  it("lets an attended run proceed unconfined", () => {
    expect(() => assertSandboxReady(unavailable, false)).not.toThrow();
  });
  it("lets an autonomous run proceed when the operator explicitly turned it off", () => {
    const explicit = resolveSandboxPosture("/p", { setting: off, backend: missing }).posture;
    expect(() => assertSandboxReady(explicit, true)).not.toThrow();
  });
});

describe("formatSandboxPosture", () => {
  it("says plainly when commands run with full permissions", () => {
    expect(formatSandboxPosture(resolveSandboxPosture("/p", { setting: off, backend: seatbelt }).posture)).toMatch(/OFF.*full user permissions/);
    expect(formatSandboxPosture(resolveSandboxPosture("/p", { setting: on, backend: missing }).posture)).toMatch(/unavailable.*full user permissions/);
    expect(formatSandboxPosture(resolveSandboxPosture("/p", { setting: on, backend: seatbelt }).posture)).toBe("sandbox: on (seatbelt, tool network none)");
  });
});

describe("createToolSandbox", () => {
  it("returns null when off or unavailable", () => {
    expect(createToolSandbox("/p", { setting: off, backend: seatbelt })).toBeNull();
    expect(createToolSandbox("/p", { setting: on, backend: missing })).toBeNull();
  });

  it("wraps argv in a profile scoped to the real project, a private scratch dir and the git identity", () => {
    const project = tempProject();
    const sandbox = createToolSandbox(project, { setting: on, backend: seatbelt })!;
    try {
      const inv = sandbox.wrap("sh", ["-c", "npm test"]);
      expect(inv.file).toBe("/usr/bin/sandbox-exec");
      const profile = inv.args[1];
      expect(profile).toContain(`(subpath "${project}")`);
      expect(profile).toContain(`(subpath "${sandbox.tmpDir}")`);
      expect(profile).toContain(`(subpath "${join(project, ".hench")}")`);
      expect(profile).toContain(".gitconfig");
      expect(profile).toContain("(deny network*)");
      expect(inv.args.slice(2)).toEqual(["sh", "-c", "npm test"]);
      expect(inv.env.TMPDIR).toBe(sandbox.tmpDir);
      expect(existsSync(sandbox.tmpDir)).toBe(true);
    } finally {
      sandbox.dispose();
    }
    expect(existsSync(sandbox.tmpDir)).toBe(false);
    expect(() => sandbox.dispose()).not.toThrow();
  });
});

describe("tool children route through the sandbox", () => {
  it("run_command spawns the sandbox's invocation, not the bare shell", async () => {
    const project = tempProject();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const fake: ToolSandbox = {
      backend: seatbelt, setting: on, tmpDir: project,
      // Stand-in for sandbox-exec: echo a marker so the test sees the wrapper ran.
      wrap: (file, args) => { calls.push({ file, args }); return { file: "node", args: ["-e", "console.log('via-sandbox')"], env: { TMPDIR: project } }; },
      wrapShell: (command) => { calls.push({ file: "sh", args: ["-c", command] }); return { file: "node", args: ["-e", "console.log('via-sandbox')"], env: { TMPDIR: project } }; },
      dispose: () => {},
    };
    const guard = new GuardRails(project, guardDefaultsForLanguage("typescript"), { sandbox: fake });
    const out = await toolRunCommand(guard, project, { command: "node --version" });
    expect(out).toContain("via-sandbox");
    expect(calls).toEqual([{ file: "sh", args: ["-c", "node --version"] }]);
  });

  it("GuardRails without a sandbox runs unconfined, as before", () => {
    expect(new GuardRails(tempProject(), guardDefaultsForLanguage("typescript")).sandbox).toBeNull();
  });
});

/**
 * Live confinement: runs only where the OS backend can apply a profile. It
 * cannot nest inside another Seatbelt sandbox, so it skips under an agent
 * harness that is itself sandboxed, and runs on an ordinary macOS or Linux
 * (with bubblewrap) machine and in CI.
 */
const live = detectSandboxBackend();
describe.skipIf(!live.available)(`live ${live.name} confinement`, () => {
  function confinedRun(project: string, command: string): Promise<string> {
    const sandbox = createToolSandbox(project, { setting: on })!;
    const guard = new GuardRails(project, { ...guardDefaultsForLanguage("typescript"), allowedCommands: ["node", "sh", "cat", "git"] }, { sandbox });
    return toolRunCommand(guard, project, { command }).finally(() => sandbox.dispose());
  }

  it("cannot write outside the project", async () => {
    const project = tempProject();
    const outside = tempProject();
    await confinedRun(project, `node -e "require('fs').writeFileSync('${join(outside, "escaped")}', 'x')"`);
    expect(existsSync(join(outside, "escaped"))).toBe(false);
  });

  it("cannot rewrite hench's own config", async () => {
    const project = tempProject();
    mkdirSync(join(project, ".hench"));
    writeFileSync(join(project, ".hench", "config.json"), "original");
    await confinedRun(project, `node -e "require('fs').writeFileSync('.hench/config.json', 'TAMPERED')"`);
    expect(readFileSync(join(project, ".hench", "config.json"), "utf-8")).toBe("original");
  });

  it("can still write inside the project", async () => {
    const project = tempProject();
    await confinedRun(project, `node -e "require('fs').writeFileSync('ok.txt', 'y')"`);
    expect(readFileSync(join(project, "ok.txt"), "utf-8")).toBe("y");
  });

  it("cannot read the operator's ssh directory", async () => {
    const project = tempProject();
    const out = await confinedRun(project, `node -e "try{console.log(require('fs').readdirSync('${join(homedir(), ".ssh")}').length)}catch(e){console.log('denied:'+e.code)}"`);
    expect(out).toMatch(/denied:(EPERM|EACCES|ENOENT)/);
  });

  it("cannot open a network connection", async () => {
    const project = tempProject();
    const out = await confinedRun(project, `node -e "require('net').connect(443,'1.1.1.1').on('connect',()=>console.log('connected')).on('error',e=>console.log('blocked:'+e.code))"`);
    expect(out).not.toContain("connected");
  });
});

describe("createVendorCliSandbox", () => {
  it("leaves Codex to its own sandbox, and respects off/unavailable", () => {
    expect(createVendorCliSandbox("/p", "codex", { cliBinary: "/bin/codex", setting: on, backend: seatbelt })).toBeNull();
    expect(createVendorCliSandbox("/p", "claude", { cliBinary: "/bin/claude", setting: off, backend: seatbelt })).toBeNull();
    expect(createVendorCliSandbox("/p", "claude", { cliBinary: "/bin/claude", setting: on, backend: missing })).toBeNull();
  });

  it("gives the Claude CLI its config, TLS network and the project, but not hench's config or other credentials", () => {
    const project = tempProject();
    const sandbox = createVendorCliSandbox(project, "claude", {
      cliBinary: process.execPath, setting: on, backend: seatbelt,
      env: { ...process.env, CLAUDE_CONFIG_DIR: undefined },
    })!;
    try {
      const inv = sandbox.wrap("claude", ["-p"]);
      // The CLI's own temp root is redirected into the scratch directory the profile grants.
      expect(inv.env).toMatchObject({ TMPDIR: sandbox.tmpDir, CLAUDE_CODE_TMPDIR: sandbox.tmpDir, CLAUDE_TMPDIR: sandbox.tmpDir });
      const profile = inv.args[1];
      const home = realpathSync(homedir());
      expect(profile).toContain(`(subpath "${project}")`);
      expect(profile).toContain(`(subpath "${join(home, ".claude")}")`);
      if (process.platform === "darwin") {
        // The CLI's login lives in the keychain; it must be granted, not merely left undenied.
        expect(profile).toContain(`(subpath "${join(home, "Library", "Keychains")}")`);
      }
      expect(profile).toContain(".claude\\.json");
      expect(profile).toContain('(remote tcp "*:443")');
      const deny = profile.split("\n").find((l) => l.startsWith("(deny file-read* file-write*"))!;
      expect(deny).toContain(join(project, ".hench", "config.json"));
      expect(deny).not.toContain(`"${join(project, ".rex")}"`);
      expect(deny).toContain(join(home, ".ssh"));
    } finally {
      sandbox.dispose();
    }
  });
});
