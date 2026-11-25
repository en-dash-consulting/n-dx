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
import { execRepoShellCmd, resolveMdsCacheDir } from "../../../src/guard/sandbox.js";
import { exec } from "../../../src/process/exec.js";
import { execArgv } from "../../../src/tools/exec-shell.js";

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

/**
 * Seatbelt and bubblewrap exist only on macOS and Linux: these cases build their
 * POSIX profiles from real temp paths (and hook files' exec bits), which on
 * Windows would assert path spelling, not policy.
 */
const posixOnly = describe.skipIf(process.platform === "win32");

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

posixOnly("createToolSandbox", () => {
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

  it("clears a stale validation-slot holder from the host before each confined spawn", async () => {
    const env = { MARK: "tool" };
    const seen: NodeJS.ProcessEnv[] = [];
    const sandbox = createToolSandbox(tempProject(), {
      setting: on, backend: seatbelt, env, reclaimSlot: async (e) => { seen.push(e); },
    })!;
    try {
      await sandbox.prepareSpawn({});
      await sandbox.prepareSpawn({});
      expect(seen).toEqual([env, env]);
    } finally {
      sandbox.dispose();
    }
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
      prepareSpawn: async (base) => { calls.push({ file: "prepare", args: [] }); return base; },
      dispose: () => {},
    };
    const guard = new GuardRails(project, guardDefaultsForLanguage("typescript"), { sandbox: fake });
    const out = await toolRunCommand(guard, project, { command: "node --version" });
    expect(out).toContain("via-sandbox");
    expect(calls).toEqual([{ file: "prepare", args: [] }, { file: "sh", args: ["-c", "node --version"] }]);

    calls.length = 0;
    await execArgv({ file: "git", args: ["status"], cwd: project, timeout: 30_000, sandbox: fake });
    expect(calls).toEqual([{ file: "prepare", args: [] }, { file: "git", args: ["status"] }]);
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

  it("confines the test gate's command the same way", async () => {
    const project = tempProject();
    const outside = tempProject();
    const result = await execRepoShellCmd(
      `node -e "require('fs').writeFileSync('${join(outside, "escaped")}', 'x')"`,
      { cwd: project, timeout: 30_000 },
      { setting: on },
    );
    expect(result.launched).toBe(true);
    expect(existsSync(join(outside, "escaped"))).toBe(false);
  });

  it("cannot open a network connection", async () => {
    const project = tempProject();
    const out = await confinedRun(project, `node -e "require('net').connect(443,'1.1.1.1').on('connect',()=>console.log('connected')).on('error',e=>console.log('blocked:'+e.code))"`);
    expect(out).not.toContain("connected");
  });
});

describe("execRepoShellCmd", () => {
  it("runs the command unconfined when the operator turned the sandbox off", async () => {
    const project = tempProject();
    const result = await execRepoShellCmd(
      `node -e "require('fs').writeFileSync('gate.txt', 'ran')"`,
      { cwd: project, timeout: 30_000 },
      { setting: off, backend: seatbelt },
    );
    expect(result.launched).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(project, "gate.txt"), "utf-8")).toBe("ran");
  });

  it("clears a stale validation-slot holder from the host before the command, even unconfined", async () => {
    // These are hench's own validation steps: during a vendor-CLI session they
    // are where a dead host holder is cleared for the session's confined runners.
    const project = tempProject();
    const ranFirst: boolean[] = [];
    const reclaimSlot = async (): Promise<void> => { ranFirst.push(!existsSync(join(project, "gate.txt"))); };
    const command = `node -e "require('fs').writeFileSync('gate.txt', 'ran')"`;
    await execRepoShellCmd(command, { cwd: project, timeout: 30_000 }, { setting: off, backend: seatbelt, reclaimSlot });
    expect(ranFirst).toEqual([true]);
  });

  it("reports a wrapped command that never launched instead of throwing", async () => {
    // A backend binary that cannot be found: the wrapped spawn fails, and the
    // result says so the way execShellCmd would.
    const project = tempProject();
    const bogus = { name: "bwrap" as const, available: true };
    const prevPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await execRepoShellCmd("true", { cwd: project, timeout: 10_000, env: { PATH: "" } }, { setting: on, backend: bogus });
      expect(result.launched).toBe(false);
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

posixOnly("createVendorCliSandbox", () => {
  it("leaves Codex to its own sandbox, and respects off/unavailable", () => {
    expect(createVendorCliSandbox("/p", "codex", { cliBinary: "/bin/codex", setting: on, backend: seatbelt })).toBeNull();
    expect(createVendorCliSandbox("/p", "claude", { cliBinary: "/bin/claude", setting: off, backend: seatbelt })).toBeNull();
    expect(createVendorCliSandbox("/p", "claude", { cliBinary: "/bin/claude", setting: on, backend: missing })).toBeNull();
  });

  it("clears a stale validation-slot holder from the host before the CLI starts", async () => {
    const env = { ...process.env, MARK: "cli" };
    const seen: NodeJS.ProcessEnv[] = [];
    const sandbox = createVendorCliSandbox(tempProject(), "claude", {
      cliBinary: process.execPath, setting: on, backend: seatbelt, env, reclaimSlot: async (e) => { seen.push(e); },
    })!;
    try {
      await sandbox.prepareSpawn({});
      expect(seen).toEqual([env]);
    } finally {
      sandbox.dispose();
    }
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
        // The CLI's login lives in the keychain; it must be granted, not merely
        // left undenied — and only for reading, since securityd does the writes.
        const keychains = `(subpath "${join(home, "Library", "Keychains")}")`;
        const lines = profile.split("\n");
        expect(lines.some((l) => l.startsWith("(allow file-read* ") && !l.includes("file-write*") && l.includes(keychains))).toBe(true);
        expect(lines.some((l) => l.includes("file-write*") && l.startsWith("(allow") && l.includes(keychains))).toBe(false);
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

/** The `(allow file-read* file-write* …)` line holding the profile's read-write roots. */
function readWriteLine(profile: string): string {
  return profile.split("\n").find((l) => l.startsWith("(allow file-read* file-write* (subpath "))!;
}

/**
 * Every `(subpath …)` under /private/var/folders on a line other than
 * `expected` (the test's temp project and the sandbox's scratch dir live there).
 */
function otherVarFolders(line: string, ...expected: string[]): string[] {
  return [...line.matchAll(/\(subpath "(\/private\/var\/folders\/[^"]*)"\)/g)]
    .map((m) => m[1])
    .filter((p) => !expected.includes(p));
}

describe("resolveMdsCacheDir", () => {
  it("returns the real path of <cache>/mds", () => {
    const cache = tempProject();
    mkdirSync(join(cache, "mds"));
    expect(resolveMdsCacheDir(() => `${cache}/\n`)).toBe(realpathSync(join(cache, "mds")));
  });

  it("returns null when getconf fails, answers nothing, or the folder is missing", () => {
    expect(resolveMdsCacheDir(() => { throw new Error("getconf: not found"); })).toBeNull();
    expect(resolveMdsCacheDir(() => "\n")).toBeNull();
    expect(resolveMdsCacheDir(() => tempProject())).toBeNull();
  });
});

describe.skipIf(process.platform !== "darwin")("macOS Security MDS cache", () => {
  it("is read-write to the vendor CLI, and the only path opened under /private/var/folders besides its scratch dir", () => {
    const cache = tempProject();
    mkdirSync(join(cache, "mds"));
    const mds = realpathSync(join(cache, "mds"));
    const project = tempProject();
    const sandbox = createVendorCliSandbox(project, "claude", {
      cliBinary: process.execPath, setting: on, backend: seatbelt, mdsCacheDir: () => mds,
    })!;
    try {
      const rw = readWriteLine(sandbox.wrap("claude", ["-p"]).args[1]);
      expect(rw).toContain(`(subpath "${mds}")`);
      expect(otherVarFolders(rw, project, sandbox.tmpDir, mds)).toEqual([]);
    } finally {
      sandbox.dispose();
    }
  });

  it("builds the profile as before when the folder cannot be resolved", () => {
    const project = tempProject();
    const sandbox = createVendorCliSandbox(project, "claude", {
      cliBinary: process.execPath, setting: on, backend: seatbelt, mdsCacheDir: () => null,
    })!;
    try {
      const profile = sandbox.wrap("claude", ["-p"]).args[1];
      expect(otherVarFolders(readWriteLine(profile), project, sandbox.tmpDir)).toEqual([]);
      // The keychain directory stays read-only either way.
      const keychains = `(subpath "${join(realpathSync(homedir()), "Library", "Keychains")}")`;
      expect(profile.split("\n").some((l) => l.startsWith("(allow") && l.includes("file-write*") && l.includes(keychains))).toBe(false);
    } finally {
      sandbox.dispose();
    }
  });

  it("is not opened to the tool sandbox", () => {
    const mds = resolveMdsCacheDir();
    const project = tempProject();
    const sandbox = createToolSandbox(project, { setting: on, backend: seatbelt })!;
    try {
      const profile = sandbox.wrap("sh", ["-c", "true"]).args[1];
      if (mds) expect(profile).not.toContain(mds);
      expect(otherVarFolders(readWriteLine(profile), project, sandbox.tmpDir)).toEqual([]);
    } finally {
      sandbox.dispose();
    }
  });
});

/**
 * Live: a keychain lookup inside the vendor-cli profile reaches securityd and
 * gets an ordinary "not found", not a Module Directory Service error. Needs a
 * usable Seatbelt (skipped when nested inside another sandbox).
 */
describe.skipIf(process.platform !== "darwin" || !live.available)("live vendor-cli keychain lookup", () => {
  it("answers without a Module Directory Service error", async () => {
    const project = tempProject();
    const sandbox = createVendorCliSandbox(project, "claude", { cliBinary: process.execPath, setting: on })!;
    try {
      const inv = sandbox.wrap("/usr/bin/security", ["find-generic-password", "-s", `n-dx-absent-${process.pid}-${Date.now()}`]);
      const base = await sandbox.prepareSpawn(process.env);
      const result = await exec(inv.file, inv.args, { cwd: project, timeout: 30_000, env: { ...base, ...inv.env } });
      expect(result.stderr).not.toMatch(/Module Directory Service/i);
      expect(result.stderr).toMatch(/could not be found/i);
    } finally {
      sandbox.dispose();
    }
  });
});
