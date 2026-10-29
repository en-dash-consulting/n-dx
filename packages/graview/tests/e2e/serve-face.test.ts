/**
 * `ndx graview serve` runs the product face as the `graview-face` extension:
 * through the real core CLI, which finds it (`extensions.paths` in an n-dx
 * home of the test's own), checks its approval and hands over the launch plan.
 * A stand-in face records the arguments and environment it was given, so the
 * flags and variables `serve` always passed are checked without starting Vite.
 * Needs the built `@n-dx/graview` (`dist/cli/index.js`), which core spawns.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";
import { makeProject } from "../helpers/project.js";

const CORE_CLI = resolve(import.meta.dirname, "../../../core/cli.js");
const GRAVIEW_CLI = resolve(import.meta.dirname, "../../dist/cli/index.js");
const REAL_FACE = resolve(import.meta.dirname, "../../../graview-face");

/** Writes what it was started with to `$FACE_REPORT` and exits. */
const RECORDER = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.FACE_REPORT, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }));
`;

let scratch: string;
let home: string;
let face: string;
let project: string;
let report: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "graview-face-e2e-"));
  home = join(scratch, "home");
  face = join(scratch, "face");
  report = join(scratch, "report.json");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(face, "bin"), { recursive: true });
  writeFileSync(join(face, "bin", "serve.js"), RECORDER);
  writeFileSync(join(face, "package.json"), JSON.stringify({
    name: "stand-in-graview-face",
    version: "1.0.0",
    type: "module",
    ndx: { extension: { apiVersion: 1, name: "graview-face", ndxVersion: ">=0.0.0", sidecar: { bin: "bin/serve.js" } } },
  }));
  devPaths([face]);
  project = makeProject();
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

function devPaths(paths: string[]): void {
  writeFileSync(join(home, "config.json"), JSON.stringify({ extensions: { paths } }));
}

function ndx(args: string[], extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, N_DX_HOME: home, NDX_HOME: "", FACE_REPORT: report, ...extraEnv };
  delete env["NDX_CLI_PATH"];
  const result = spawnSync(process.execPath, [CORE_CLI, ...args], { cwd: project, env, encoding: "utf-8", timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function recorded(): { argv: string[]; cwd: string; env: Record<string, string | undefined> } {
  return JSON.parse(readFileSync(report, "utf-8"));
}

describe("ndx graview serve with the face as an extension", () => {
  it("refuses an unapproved face with exit 2, naming the fix and --no-face", () => {
    const result = ndx(["graview", "serve", project]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("ndx extensions enable graview-face");
    expect(result.stderr).toContain("--no-face");
    expect(existsSync(report)).toBe(false);
  });

  it("runs an enabled face with the flags and the environment serve always gave it", () => {
    expect(ndx(["extensions", "enable", "graview-face", "--yes"]).code).toBe(0);
    const result = ndx(["graview", "serve", project, "--port", "5299"], { PORT: "1" });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`product face: ${face}`);

    const { argv, env } = recorded();
    expect(argv).toEqual(["--port", "5299"]);
    const layout = resolveLayout(project);
    expect(env["NDX_GRAVIEW_DIR"]).toBe(layout.graviewDir);
    expect(env["NDX_PROJECT_ROOT"]).toBe(layout.root);
    expect(env["NDX_GRAVIEW_CLI"]).toBe(GRAVIEW_CLI);
    // The extension contract comes with it; the hub's PORT does not.
    expect(env["NDX_EXTENSION_NAME"]).toBe("graview-face");
    expect(env["NDX_HOME"]).toBe(home);
    expect(env["PORT"]).toBeUndefined();
  });

  it("draws the bare store when the face is disabled or --no-face is passed", () => {
    const bareBin = join(scratch, "graview.js");
    writeFileSync(bareBin, RECORDER);
    expect(ndx(["extensions", "enable", "graview-face", "--yes"]).code).toBe(0);
    expect(ndx(["graview", "serve", project, "--no-face"], { NDX_GRAVIEW_BIN: bareBin }).code).toBe(0);
    expect(recorded().argv[0]).toBe("serve");

    rmSync(report);
    expect(ndx(["extensions", "disable", "graview-face"]).code).toBe(0);
    const result = ndx(["graview", "serve", project], { NDX_GRAVIEW_BIN: bareBin });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("product face: disabled");
    expect(recorded().argv[0]).toBe("serve");
  });
});

describe("@n-dx/graview-face's ndx.extension block", () => {
  it("is a valid manifest declaring the graview-face sidecar", () => {
    devPaths([REAL_FACE]);
    const result = ndx(["extensions", "info", "graview-face", "--json"]);
    expect(result.code).toBe(0);
    const info = JSON.parse(result.stdout) as { state: string; dir: string; problems: unknown[]; manifest: { sidecar?: { bin: string } } | null };
    expect(info.state).toBe("unapproved");
    expect(info.problems).toEqual([]);
    expect(info.manifest?.sidecar?.bin).toBe("bin/serve.js");
  });
});
