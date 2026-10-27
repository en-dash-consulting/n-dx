/**
 * `ndx graview serve` never runs a repository-chosen product face while the
 * checkout is untrusted (#635 follow-up). The spawn is recorded rather than
 * run: the untrusted fallback is the installed `@n-dx/graview-face`, a real
 * server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateRepoTrust, recordRepoTrust } from "@n-dx/llm-client";
import { makeProject } from "../helpers/project.js";

const spawned = vi.hoisted(() => [] as { cmd: string; args: string[]; cwd: string }[]);

vi.mock("../../src/llm-gateway.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/llm-gateway.js")>();
  return {
    ...actual,
    spawnCli: (cmd: string, args: string[], options: { cwd: string }) => {
      spawned.push({ cmd, args, cwd: options.cwd });
      const child = new EventEmitter();
      setImmediate(() => child.emit("exit", 0, null));
      return child;
    },
  };
});

const { main, findProductFace } = await import("../../src/cli/index.js");

let root: string;
let home: string;
let repoFace: string;

const ranRepoFace = () => spawned.some((s) => s.cwd === repoFace || s.args.some((a) => a.startsWith(repoFace)));

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, stdio: "ignore" });
}

beforeEach(() => {
  spawned.length = 0;
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-app-home-"));
  repoFace = join(root, "face");
  mkdirSync(join(repoFace, "bin"), { recursive: true });
  writeFileSync(join(repoFace, "bin", "serve.js"), "process.exit(0);\n");
  vi.stubEnv("NDX_HOME", home);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

describe("a repository's graview.app in an untrusted checkout", () => {
  it("is a vendor-cli-path finding in the digest, and serve does not run it", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "./face" } }));
    const ev = evaluateRepoTrust(root);
    expect(ev.state).toBe("untrusted");
    expect(ev.findings.find((f) => f.code === "vendor-cli-path")?.values).toEqual(["graview.app = ./face"]);
    expect(ev.config.vendorCliPaths).toEqual(["graview.app = ./face"]);

    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(false);
  });

  it("runs once the checkout is trusted, and waits again when it changes", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "./face" } }));
    const before = evaluateRepoTrust(root).config.digest;
    recordRepoTrust(root);
    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(spawned).toContainEqual({ cmd: process.execPath, args: [join(repoFace, "bin", "serve.js")], cwd: repoFace });

    spawned.length = 0;
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "./face/" } }));
    expect(evaluateRepoTrust(root).config.digest).not.toBe(before);
    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(false);
  });

  it("gates a graview.app in a git-tracked .n-dx.local.json until trusted", async () => {
    git("init", "-q");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { app: "./face" } }));
    git("add", ".n-dx.local.json");
    git("commit", "-q", "-m", "ship local config");
    expect(evaluateRepoTrust(root).config.vendorCliPaths).toEqual(["graview.app = ./face"]);

    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(false);

    recordRepoTrust(root);
    spawned.length = 0;
    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(true);
  });

  it("keeps applying a graview.app in an untracked .n-dx.local.json without trust", async () => {
    git("init", "-q");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { app: "./face" } }));
    expect(evaluateRepoTrust(root).state).toBe("baseline");
    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(true);
  });
});

describe("the default face lookup (graview.app unset)", () => {
  it("never resolves into the checkout's own node_modules", () => {
    const shipped = join(root, "node_modules", "@n-dx", "graview-face");
    mkdirSync(join(shipped, "bin"), { recursive: true });
    writeFileSync(join(shipped, "package.json"), JSON.stringify({ name: "@n-dx/graview-face" }));
    writeFileSync(join(shipped, "bin", "serve.js"), "process.exit(0);\n");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      expect(findProductFace()?.startsWith(root) ?? false).toBe(false);
    } finally {
      cwd.mockRestore();
    }
  });
});
