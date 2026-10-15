/**
 * What the published tarballs carry: sourcevision's holds no grammar and no
 * query, each language pack's holds its own grammar and queries, and
 * sourcevision loads a pack from the per-user pack directory.
 *
 * Packs each package with `pnpm pack` and checks the file list. For every
 * pack sourcevision knows, it then extracts the tarball to
 * `<pack dir>/node_modules/<name>` — the layout `npm install --prefix
 * <pack dir>` produces — and, in a plain Node process, runs sourcevision's
 * built `loadPack` against that pack directory and the loaded entry over a
 * one-file project. A `files` entry that drops the grammar or a query fails
 * here instead of degrading every install of the pack. A second copy without
 * its grammar must name the published-install remedy, not a build script.
 *
 * Needs built dists (sourcevision and the packs); the pack checks need built
 * grammars and skip without them, unless SV_REQUIRE_GRAMMARS=1, which the
 * release job sets, makes a missing grammar fail.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KNOWN_PACKS } from "../../src/language/pack-loader.js";
import type { SkippableTest } from "../helpers/workspace-pack.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = dirname(PACKAGE_ROOT);

/** Each pack package's grammar, by directory under packages/. */
const GRAMMARS: Record<string, string> = {
  "lang-java": "tree-sitter-java",
  "lang-go": "tree-sitter-go",
  "lang-sql": "tree-sitter-sql",
  "lang-terraform": "tree-sitter-hcl",
};

/** The packages under packages/lang-* that are not packs. */
const NOT_PACKS = new Set(["lang-kit", "lang-runtime"]);

/** A one-file project per pack sourcevision loads. */
const SAMPLES: Record<string, Record<string, string>> = {
  java: { "src/A.java": "package a;\n\nclass A {}\n" },
  go: { "go.mod": "module example.com/a\n", "a.go": "package a\n" },
  terraform: { "main.tf": 'resource "aws_s3_bucket" "a" {}\n' },
};

interface Report {
  status: string;
  source?: string;
  facts?: number;
  degraded?: { reason: string; remedy?: string };
  notice?: { reason: string; remedy?: string };
}

interface Packed {
  readonly tarball: string;
  readonly files: Set<string>;
}

/** Skip unless `wasmPath` is built; throw instead when SV_REQUIRE_GRAMMARS=1. */
function skipUnlessGrammarBuilt(ctx: SkippableTest, wasmPath: string): void {
  if (existsSync(wasmPath)) return;
  const message = `${wasmPath} is not built — run \`pnpm -r run build:grammars\``;
  if (process.env["SV_REQUIRE_GRAMMARS"] === "1") throw new Error(`${message} (SV_REQUIRE_GRAMMARS=1 forbids skipping)`);
  ctx.skip(message);
}

/** Fail first, and plainly, when a dist the test packs or runs is missing. */
function requireDist(dirName: string, file: string): void {
  if (!existsSync(join(PACKAGES, dirName, "dist", file))) {
    throw new Error(`${dirName}'s dist is not built — run \`pnpm --filter @n-dx/${dirName} build\``);
  }
}

describe("packed tarballs", () => {
  let work: string;
  const packs = new Map<string, Packed>();

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sv-packed-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** `pnpm pack` the package under packages/`dirName`, once. */
  function pack(dirName: string): Packed {
    const done = packs.get(dirName);
    if (done) return done;
    // pnpm, not npm: npm runs `prepare` on pack and would rebuild dist mid-suite.
    const out = execFileSync("pnpm", ["pack", "--json", "--pack-destination", work], {
      cwd: join(PACKAGES, dirName),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });
    const report = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { filename: string; files: { path: string }[] };
    const packed = { tarball: report.filename, files: new Set(report.files.map((f) => f.path)) };
    packs.set(dirName, packed);
    return packed;
  }

  /** Extract the pack's tarball into a fresh pack directory, as `npm install --prefix` lays it out. */
  function installInto(dirName: string, packDir: string): void {
    const extract = mkdtempSync(join(work, "extract-"));
    execFileSync("tar", ["-xzf", pack(dirName).tarball, "-C", extract], { cwd: work });
    const installed = join(packDir, "node_modules", "@n-dx", dirName);
    mkdirSync(dirname(installed), { recursive: true });
    cpSync(join(extract, "package"), installed, { recursive: true });
    // Dependencies come from the workspace; the pack's own files come only from the tarball.
    symlinkSync(join(PACKAGES, dirName, "node_modules"), join(installed, "node_modules"), "junction");
  }

  /** Load the pack with sourcevision's built loader from `packDir` and run it over its sample, in plain Node. */
  function loadAndRun(id: string, packDir: string): Report {
    const projectDir = mkdtempSync(join(work, `project-${id}-`));
    const files = SAMPLES[id]!;
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(projectDir, path)), { recursive: true });
      writeFileSync(join(projectDir, path), text);
    }
    const sources = Object.keys(files).filter((f) => !f.endsWith(".mod"));
    const script = `
      const { KNOWN_PACKS, loadPack } = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, "dist", "language", "pack-loader.js")).href)});
      const load = await loadPack(KNOWN_PACKS.find((p) => p.id === ${JSON.stringify(id)}), { packDir: ${JSON.stringify(packDir)} });
      if (load.status !== "loaded") {
        console.log(JSON.stringify(load));
      } else {
        const result = await load.entry.analyzeProject({ projectDir: ${JSON.stringify(projectDir)}, files: ${JSON.stringify(sources)} });
        console.log(JSON.stringify({ status: load.status, source: load.source, facts: result.facts.length, degraded: result.degraded }));
      }
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: work, encoding: "utf-8" });
    return JSON.parse(out) as Report;
  }

  it("lists every pack package's grammar here", () => {
    const packDirs = readdirSync(PACKAGES).filter((d) => d.startsWith("lang-") && !NOT_PACKS.has(d)).sort();
    expect(Object.keys(GRAMMARS).sort()).toEqual(packDirs);
  });

  it("@n-dx/sourcevision carries no grammar and no query", () => {
    requireDist("sourcevision", join("language", "pack-loader.js"));
    const { files } = pack("sourcevision");
    expect(files.size).toBeGreaterThan(0);
    expect([...files].filter((f) => f.endsWith(".wasm") || f.endsWith(".scm") || /(^|\/)queries\//.test(f))).toEqual([]);
  });

  for (const [dirName, grammar] of Object.entries(GRAMMARS)) {
    it(`@n-dx/${dirName} carries its grammar WASM and query files, and no build scratch`, (ctx) => {
      skipUnlessGrammarBuilt(ctx, join(PACKAGES, dirName, "build", "grammars", `${grammar}.wasm`));
      requireDist(dirName, "index.js");
      const { files } = pack(dirName);
      expect(files).toContain(`build/grammars/${grammar}.wasm`);
      expect([...files].filter((f) => f.endsWith(".wasm"))).toEqual([`build/grammars/${grammar}.wasm`]);
      const queryRoot = join(PACKAGES, dirName, "queries");
      const queries = existsSync(queryRoot)
        ? readdirSync(queryRoot, { recursive: true, withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => join(e.parentPath, e.name).slice(join(PACKAGES, dirName).length + 1).split("\\").join("/"))
        : [];
      for (const q of queries) expect(files, q).toContain(q);
      expect([...files].filter((f) => f.startsWith("build/") && !f.startsWith("build/grammars/"))).toEqual([]);
    });
  }

  describe("loaded from a pack directory", () => {
    for (const known of KNOWN_PACKS) {
      const dirName = known.packageName.split("/")[1]!;

      describe(known.packageName, () => {
        let packDir = "";

        function prepare(ctx: SkippableTest): void {
          skipUnlessGrammarBuilt(ctx, join(PACKAGES, dirName, "build", "grammars", `${GRAMMARS[dirName]}.wasm`));
          if (packDir) return;
          requireDist("sourcevision", join("language", "pack-loader.js"));
          requireDist(dirName, "pack.js");
          packDir = mkdtempSync(join(work, `packs-${known.id}-`));
          installInto(dirName, packDir);
        }

        it("has a grammar and a sample project here", () => {
          expect(GRAMMARS[dirName], `add ${dirName} to GRAMMARS`).toBeDefined();
          expect(SAMPLES[known.id], `add ${known.id} to SAMPLES`).toBeDefined();
        });

        it("loads from the pack directory and reads the sample without degrading", (ctx) => {
          prepare(ctx);
          expect(loadAndRun(known.id, packDir)).toEqual({ status: "loaded", source: "pack-dir", facts: 1 });
        });

        it("names the published-install remedy, not a build script, when the installed pack lacks its grammar", (ctx) => {
          prepare(ctx);
          const stripped = mkdtempSync(join(work, `packs-${known.id}-stripped-`));
          installInto(dirName, stripped);
          rmSync(join(stripped, "node_modules", "@n-dx", dirName, "build"), { recursive: true, force: true });
          const report = loadAndRun(known.id, stripped);
          expect(report.status).toBe("loaded");
          expect(report.degraded?.remedy).toBe(
            `Published ${known.packageName} ships this grammar, so this install is incomplete: reinstall ${known.packageName}.`,
          );
        });
      });
    }
  });
});
