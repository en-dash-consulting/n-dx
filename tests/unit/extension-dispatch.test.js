/**
 * `ndx <name>` dispatch to extensions (packages/core/extension-dispatch.js):
 * which installed command a name resolves to, and the process contract —
 * n-dx's Node, args passed on, signals forwarded, exit code passed through.
 * The same paths through the real CLI are in tests/e2e/cli-extensions.test.js.
 *
 * @see docs/architecture/extensions.md — "CLI delegation"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveOnFirstRun, listExtensionCommands, packageFile, resolveExtensionCommand, runExtensionCommand, EXTENSION_REFUSED_EXIT_CODE } from "../../packages/core/extension-dispatch.js";
import { describeForApproval } from "../../packages/core/extension-state.js";
import { runExtensions } from "../../packages/core/extensions-command.js";

const BUILTINS = ["init", "work", "status", "config", "extensions", "rex"];
const NDX_VERSION = "0.10.0";

let root;
let home;
let project;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-ext-dispatch-"));
  home = join(root, "home");
  project = join(root, "project");
  for (const dir of [home, project]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFile(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/**
 * Install a user-source extension named `name` with one command `name`, whose
 * bin is `script` (omit for a missing bin).
 */
function install(name, { script, ndxVersion = ">=0.10.0", commands, folder = join(home, "extensions") } = {}) {
  const listing = join(folder, "package.json");
  const deps = existsSync(listing) ? JSON.parse(readFileSync(listing, "utf8")).dependencies : {};
  writeFile(listing, JSON.stringify({ name: "ndx-user-extensions", dependencies: { ...deps, [`ndx-${name}`]: "^1.0.0" } }));
  const dir = join(folder, "node_modules", `ndx-${name}`);
  writeFile(join(dir, "package.json"), JSON.stringify({
    name: `ndx-${name}`,
    version: "1.0.0",
    ndx: { extension: { apiVersion: 1, name, ndxVersion, commands: commands ?? [{ name, bin: "bin/cli.js", summary: name }] } },
  }));
  if (script !== undefined) writeFile(join(dir, "bin", "cli.js"), script);
  return dir;
}

const deps = (builtinCommands = BUILTINS) => ({ builtinCommands, home, globalRoot: null, cwd: project, ndxVersion: NDX_VERSION });
const resolveName = (name, builtinCommands) => resolveExtensionCommand(name, deps(builtinCommands));

async function enable(name) {
  const lines = [];
  const code = await runExtensions(["enable", name, "--yes"], { ...deps(), out: (l) => lines.push(l), err: (l) => lines.push(l) });
  expect(code, lines.join("\n")).toBe(0);
}

async function disable(name) {
  expect(await runExtensions(["disable", name], { ...deps(), out: () => {}, err: () => {} })).toBe(0);
}

describe("packageFile", () => {
  it("resolves a path inside the package", () => {
    expect(packageFile(project, "bin/cli.js")).toBe(join(project, "bin", "cli.js"));
    expect(packageFile(project, "./bin/../cli.js")).toBe(join(project, "cli.js"));
    expect(packageFile(project, "..cli.js")).toBe(join(project, "..cli.js"));
  });

  it("refuses a path that resolves outside the package", () => {
    for (const bin of ["../cli.js", "bin/../../cli.js", ".", "..", join(root, "cli.js")]) {
      expect(packageFile(project, bin), bin).toBeNull();
    }
  });

  it.runIf(process.platform === "win32")("refuses a drive-relative path on Windows", () => {
    const otherDrive = /^[cC]:/.test(project) ? "D:" : "C:";
    expect(packageFile(project, `${otherDrive}evil.js`)).toBeNull();
  });
});

describe("resolveExtensionCommand", () => {
  it("resolves an enabled extension's command to its bin", async () => {
    const dir = install("recon", { script: "" });
    await enable("recon");
    expect(resolveName("recon")).toMatchObject({ kind: "run", command: "recon", bin: join(dir, "bin", "cli.js") });
  });

  it("resolves a name nothing claims to none", async () => {
    install("recon", { script: "" });
    await enable("recon");
    expect(resolveName("nothing")).toEqual({ kind: "none" });
  });

  it("never lets an extension shadow a built-in", async () => {
    install("recon", { script: "" });
    await enable("recon");
    // As if a newer n-dx added `recon` as a built-in after the extension was
    // approved: the built-in wins even though the manifest still claims it.
    expect(resolveName("recon", [...BUILTINS, "recon"])).toEqual({ kind: "builtin" });
    for (const builtin of BUILTINS) expect(resolveName(builtin)).toEqual({ kind: "builtin" });
  });

  it("refuses an unapproved extension with one line naming enable", () => {
    install("recon", { script: "" });
    const resolved = resolveName("recon");
    expect(resolved.kind).toBe("refused");
    expect(resolved.message).toMatch(/^Error: 'ndx recon' comes from extension recon \(ndx-recon 1\.0\.0, user\), which is not approved yet — fix: ndx extensions enable recon$/);
    expect(EXTENSION_REFUSED_EXIT_CODE).toBe(2);
  });

  it("refuses an enabled extension whose bin is missing, naming doctor", async () => {
    install("recon");
    await enable("recon");
    const resolved = resolveName("recon");
    expect(resolved.kind).toBe("refused");
    expect(resolved.message).toMatch(/bin bin\/cli\.js does not exist — fix: ndx extensions doctor$/);
  });

  it("gives a disabled extension's name a hint naming enable", async () => {
    install("recon", { script: "" });
    await enable("recon");
    await disable("recon");
    const resolved = resolveName("recon");
    expect(resolved).toMatchObject({ kind: "unavailable", state: "disabled" });
    expect(resolved.hint).toMatch(/provides 'recon' but is disabled: .* Run 'ndx extensions enable recon'\.$/);
  });

  it("gives an incompatible extension's name a hint naming doctor", () => {
    install("recon", { script: "", ndxVersion: ">=9.0.0" });
    const resolved = resolveName("recon");
    expect(resolved).toMatchObject({ kind: "unavailable", state: "incompatible" });
    expect(resolved.hint).toMatch(/needs n-dx >=9\.0\.0; this is 0\.10\.0\. Run 'ndx extensions doctor'\.$/);
  });

  it("resolves a second command of the same extension", async () => {
    const dir = install("recon", {
      script: "",
      commands: [{ name: "recon", bin: "bin/cli.js", summary: "r" }, { name: "recon-report", bin: "bin/cli.js", summary: "rr" }],
    });
    await enable("recon");
    expect(resolveName("recon-report")).toMatchObject({ kind: "run", command: "recon-report", bin: join(dir, "bin", "cli.js") });
  });
});

describe("approveOnFirstRun", () => {
  const ask = (answer) => {
    const questions = [];
    return { questions, confirm: async (q) => { questions.push(q); return answer; } };
  };

  it("shows package, version, source and commands, asks, and on yes approves so the command runs", async () => {
    const dir = install("recon", { script: "" });
    const { questions, confirm } = ask(true);
    const lines = [];
    expect(await approveOnFirstRun(resolveName("recon"), "recon", { confirm, out: (l) => lines.push(l) })).toBe(true);
    expect(lines).toEqual([
      "'recon' is not approved yet.",
      "  package  ndx-recon@1.0.0",
      `  source   user (${dir})`,
      "  command  ndx recon → bin/cli.js",
    ]);
    expect(questions).toEqual(["Approve 'recon' and run 'ndx recon'?"]);
    expect(resolveName("recon")).toMatchObject({ kind: "run", command: "recon" });
    const approval = JSON.parse(readFileSync(join(home, "extensions.json"), "utf8")).approvals["ndx-recon"];
    expect(approval).toMatchObject({ version: "1.0.0", source: "user" });
  });

  it("never prints a raw control character from the package on the prompt", () => {
    // A directory name may carry a newline on POSIX; the manifest itself cannot.
    const ext = {
      name: undefined,
      packageName: "ndx-evil\u001b[1A",
      version: "1.0.0\n  source   project (/trusted)",
      source: "user",
      dir: "/tmp/evil\r\u009b2K",
      manifest: undefined,
    };
    const lines = describeForApproval(ext, "not approved yet");
    for (const line of lines) expect(line).not.toMatch(/\p{Cc}/u);
    expect(lines).toEqual([
      "'ndx-evil\\x1b[1A' is not approved yet.",
      "  package  ndx-evil\\x1b[1A@1.0.0\\x0a  source   project (/trusted)",
      "  source   user (/tmp/evil\\x0d\\x9b2K)",
    ]);
  });

  it("on no, or with no terminal to ask on, approves nothing and the refusal stands", async () => {
    install("recon", { script: "" });
    expect(await approveOnFirstRun(resolveName("recon"), "recon", { confirm: ask(false).confirm, out: () => {} })).toBe(false);
    const lines = [];
    expect(await approveOnFirstRun(resolveName("recon"), "recon", { out: (l) => lines.push(l) })).toBe(false);
    expect(lines).toEqual([]);
    expect(existsSync(join(home, "extensions.json")) && JSON.parse(readFileSync(join(home, "extensions.json"), "utf8")).approvals).toBeFalsy();
    expect(resolveName("recon").message).toMatch(/fix: ndx extensions enable recon$/);
  });

  it("never asks for a refusal an approval cannot fix", async () => {
    install("recon");
    await enable("recon");
    const { questions, confirm } = ask(true);
    expect(await approveOnFirstRun(resolveName("recon"), "recon", { confirm, out: () => {} })).toBe(false);
    expect(questions).toEqual([]);
  });

  it("approves a project-source extension for that project path only", async () => {
    install("local", { script: "", folder: project });
    expect(await approveOnFirstRun(resolveName("local"), "local", { confirm: ask(true).confirm, out: () => {} })).toBe(true);
    expect(resolveName("local").kind).toBe("run");

    // The same repository cloned elsewhere brings no approval with it.
    const clone = join(root, "clone");
    install("local", { script: "", folder: clone });
    const cloned = resolveExtensionCommand("local", { ...deps(), cwd: clone });
    expect(cloned).toMatchObject({ kind: "refused", approval: { reason: "not approved for this project" } });
  });
});

describe("listExtensionCommands", () => {
  const list = (builtinCommands) => listExtensionCommands(deps(builtinCommands));

  it("lists every command of an enabled extension with its summary, sorted by name", async () => {
    install("recon", {
      script: "",
      commands: [{ name: "recon-report", bin: "bin/cli.js", summary: "Write the report" }, { name: "recon", bin: "bin/cli.js", summary: "Run recon" }],
    });
    await enable("recon");
    expect(list()).toEqual([
      { name: "recon", summary: "Run recon", extension: "recon" },
      { name: "recon-report", summary: "Write the report", extension: "recon" },
    ]);
  });

  it("lists nothing for unapproved, disabled or incompatible extensions", async () => {
    install("pending", { script: "" });
    install("off", { script: "" });
    await enable("off");
    await disable("off");
    install("future", { script: "", ndxVersion: ">=9.0.0" });
    expect(list()).toEqual([]);
  });

  it("never lists a command a built-in owns", async () => {
    install("recon", { script: "" });
    await enable("recon");
    expect(list([...BUILTINS, "recon"])).toEqual([]);
  });
});

describe("runExtensionCommand", () => {
  /** A spawn that keeps the real one but pipes stdout so the test can read it. */
  function pipedSpawn(sink) {
    return (command, args, options) => {
      sink.command = command;
      sink.args = args;
      const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "inherit"] });
      sink.child = child;
      sink.stdout = "";
      child.stdout.on("data", (chunk) => {
        sink.stdout += chunk;
        sink.onData?.(sink.stdout);
      });
      return child;
    };
  }

  for (const code of [0, 1, 7]) {
    it(`passes exit code ${code} through and runs the bin with n-dx's Node and the args`, async () => {
      const bin = join(root, "cli.js");
      writeFile(bin, `console.log(JSON.stringify(process.argv.slice(2))); process.exit(${code});`);
      const sink = {};
      const exit = await runExtensionCommand({ bin, args: ["a", "--b=c"], spawn: pipedSpawn(sink) });
      expect(exit).toBe(code);
      expect(sink.command).toBe(process.execPath);
      expect(JSON.parse(sink.stdout)).toEqual(["a", "--b=c"]);
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    it.skipIf(process.platform === "win32")(`forwards ${signal} and waits for the extension's own exit code`, async () => {
      const bin = join(root, "cli.js");
      writeFile(bin, [
        `process.on(${JSON.stringify(signal)}, () => { console.log("got ${signal}"); process.exit(7); });`,
        `console.log("ready");`,
        `setInterval(() => {}, 1000);`,
      ].join("\n"));
      const processRef = Object.assign(new EventEmitter(), { kill: (pid, sig) => process.kill(pid, sig) });
      const sink = { onData: (out) => { if (out === "ready\n") processRef.emit(signal); } };
      const exit = await runExtensionCommand({ bin, args: [], spawn: pipedSpawn(sink), processRef });
      expect(exit).toBe(7);
      expect(sink.stdout).toContain(`got ${signal}`);
      // Forwarding stops once the extension has exited.
      expect(processRef.listenerCount(signal)).toBe(0);
    });
  }

  it("on Windows sends SIGTERM to the child and leaves SIGINT to the console", async () => {
    const kills = [];
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, pid: 1, kill: (sig) => kills.push(sig) });
    const processRef = Object.assign(new EventEmitter(), { kill: () => { throw new Error("no process groups on Windows"); } });
    const done = runExtensionCommand({ bin: "x.js", args: [], spawn: () => child, processRef, platform: "win32" });
    processRef.emit("SIGINT");
    processRef.emit("SIGTERM");
    child.emit("close", null, "SIGTERM");
    expect(await done).toBe(143);
    expect(kills).toEqual(["SIGTERM"]);
  });
});
