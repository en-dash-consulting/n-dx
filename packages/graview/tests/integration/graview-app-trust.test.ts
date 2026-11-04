/**
 * `ndx graview serve` never runs a repository-chosen product face (#635
 * follow-up). `graview.app` is retired: the face is the `graview-face`
 * extension, which core finds and the user approves. A repository that still
 * sets the field gets a trust finding, and serve runs nothing it names,
 * trusted or not. Spawns are recorded rather than run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
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

const { main } = await import("../../src/cli/index.js");

let root: string;
let home: string;
let repoFace: string;

const ranRepoFace = () => spawned.some((s) => s.cwd === repoFace || s.args.some((a) => a.startsWith(repoFace)));

beforeEach(() => {
  spawned.length = 0;
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-app-home-"));
  repoFace = join(root, "face");
  mkdirSync(join(repoFace, "bin"), { recursive: true });
  writeFileSync(join(repoFace, "bin", "serve.js"), "process.exit(0);\n");
  vi.stubEnv("NDX_HOME", home);
  // `ndx work` and `ndx start` export the user's runner here; with none, serve draws the bare store.
  vi.stubEnv("NDX_CLI_PATH", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

describe("a repository's graview.app", () => {
  it("is a vendor-cli-path finding in the digest, and serve does not run it", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "./face" } }));
    const ev = evaluateRepoTrust(root);
    expect(ev.state).toBe("untrusted");
    expect(ev.findings.find((f) => f.code === "vendor-cli-path")?.values).toEqual(["graview.app = ./face"]);
    expect(ev.config.vendorCliPaths).toEqual(["graview.app = ./face"]);

    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(false);
  });

  it("runs nothing even once the checkout is trusted: the field is retired", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "./face" } }));
    recordRepoTrust(root);
    expect(await main(["serve", root, "--quiet"])).toBe(0);
    expect(ranRepoFace()).toBe(false);
  });
});
