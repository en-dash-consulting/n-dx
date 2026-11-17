/**
 * Sub-analysis discovery and `--deep` never follow a symlinked directory.
 *
 * A link to another project that has its own analysis must not promote that
 * project's zones and paths into this one, `--deep` must not run analyze
 * through it (writing into the other project), and links back to a directory
 * or its ancestor must not make the walk branch or loop. Links are created by
 * the test in a temp dir, as junctions so Windows needs no privilege.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Pass-through, so one test can count the walk's directory listings.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { setStaticOnly } from "../../src/analyzers/claude-client.js";
import { detectSubAnalyses } from "../../src/analyzers/workspace.js";

let base: string | undefined;
afterEach(() => {
  setStaticOnly(false);
  if (base) rmSync(base, { recursive: true, force: true });
  base = undefined;
});

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
}

/** Every file under `dir` with its mtime, not following links. */
function snapshot(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.set(full, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return out;
}

/** The text of every file under `dir`, joined, not following links. */
function allText(dir: string): string {
  return [...snapshot(dir).keys()].map((f) => readFileSync(f, "utf-8")).join("\n");
}

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "probe", version: "1.0.0" }),
  "src/a.ts": 'import { b } from "./b.js";\nexport const a = () => b();\n',
  "src/b.ts": "export const b = () => 1;\n",
};

const OUTSIDE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "outside", version: "1.0.0" }),
  "lib/secretzone/x.ts": 'import { y } from "./y.js";\nexport const x = () => y();\n',
  "lib/secretzone/y.ts": "export const y = () => 2;\n",
};

describe("sub-analysis discovery and symlinks", () => {
  it("never takes a linked outside project as a sub-analysis, and --deep writes nothing through it", async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "sv-symlink-")));
    const proj = join(base, "proj");
    const outside = join(base, "outside-proj");
    write(proj, FILES);
    write(outside, OUTSIDE_FILES);
    await cmdAnalyze(outside, ["--fast"]);
    expect(existsSync(join(outside, ".sourcevision", "manifest.json"))).toBe(true);

    link(outside, join(proj, "vendor-link"));
    link(outside, join(proj, "nested", "deeper-link"));

    expect(detectSubAnalyses(proj)).toEqual([]);

    const before = snapshot(outside);
    await cmdAnalyze(proj, ["--fast", "--deep"]);

    // Nothing in the outside project was written or added.
    expect(snapshot(outside)).toEqual(before);

    // No outside path or zone reached this project's output.
    const output = allText(join(proj, ".sourcevision"));
    expect(output).not.toContain("vendor-link");
    expect(output).not.toContain("deeper-link");
    expect(output).not.toContain("secretzone");
    expect(output).not.toContain(outside);
  }, 120_000);

  // File symlinks need a privilege on Windows; junctions cover directories only.
  it.skipIf(process.platform === "win32")("reads no IaC or contract file through a file symlink", async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "sv-symlink-")));
    const proj = join(base, "proj");
    const outside = join(base, "outside-proj");
    write(proj, FILES);
    write(outside, {
      "main.tf": 'resource "aws_rds_cluster" "outsidedb" {\n  engine = "postgres"\n}\n',
      "openapi.yaml": "openapi: 3.0.0\n",
    });
    symlinkSync(join(outside, "main.tf"), join(proj, "linked.tf"));
    symlinkSync(join(outside, "openapi.yaml"), join(proj, "openapi.yaml"));

    await cmdAnalyze(proj, ["--fast"]);

    const output = allText(join(proj, ".sourcevision"));
    expect(output).not.toContain("outsidedb");
    expect(output).not.toContain("linked.tf");
    expect(output).not.toContain("openapi.yaml");
  }, 120_000);

  it("walks no self link, so two in one directory cannot make the walk branch", () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "sv-symlink-")));
    const proj = join(base, "proj");
    write(proj, FILES);
    link(join(proj, "a"), join(proj, "a", "s1"));
    link(join(proj, "a"), join(proj, "a", "s2"));
    link(join(proj, "a"), join(proj, "a", "b", "s3"));

    // Count directory listings instead of timing the walk. Past the cap a
    // listing fails, which the walk treats as an unreadable directory, so a
    // regression stops and fails here by name instead of hanging the suite.
    const listed: string[] = [];
    const mocked = vi.mocked(fs.readdirSync);
    const passThrough = mocked.getMockImplementation()!;
    mocked.mockImplementation(((dir: string, ...rest: unknown[]) => {
      listed.push(String(dir));
      if (listed.length > 100) throw new Error("walk exceeded 100 listings");
      return (passThrough as (...args: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync);
    try {
      expect(detectSubAnalyses(proj)).toEqual([]);
    } finally {
      mocked.mockImplementation(passThrough);
    }
    expect(listed.length).toBeLessThan(20);
    expect(listed.filter((d) => /[\\/]s[123]([\\/]|$)/.test(d))).toEqual([]);
  });

  it("does not take a link to an ancestor holding an analysis as a sub-analysis", async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "sv-symlink-")));
    const proj = join(base, "proj");
    write(proj, FILES);
    write(join(proj, "packages", "real"), FILES);
    await cmdAnalyze(join(proj, "packages", "real"), ["--fast"]);
    await cmdAnalyze(proj, ["--fast"]);

    link(proj, join(proj, "packages", "up"));
    link(base, join(proj, "packages", "top"));

    // The real nested analysis is still found; neither link is.
    expect(detectSubAnalyses(proj).map((s) => s.prefix)).toEqual(["packages/real"]);
  }, 120_000);
});
