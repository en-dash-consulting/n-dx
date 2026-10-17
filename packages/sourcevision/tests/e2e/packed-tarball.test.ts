/**
 * The published tarball carries every built-in pack's grammar and queries.
 *
 * Packs `@n-dx/sourcevision` with `pnpm pack`, checks the file list, then
 * extracts it and runs `loadLanguagePacks` from the extracted `dist` — the
 * same layout an npm install produces — so a `files` entry that drops the
 * grammar or a query fails here instead of degrading every install to
 * inventory-only.
 *
 * Needs a built `dist` and built grammars. The release job sets
 * SV_REQUIRE_GRAMMARS=1, so a missing grammar fails this test there.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BUILTIN_PACKS } from "../../src/language/pack.js";
import { grammarBuildDir } from "../../src/language/package-paths.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Package-relative, `/`-separated — the form `pnpm pack --json` reports. */
function packagePath(absolute: string): string {
  return relative(PACKAGE_ROOT, absolute).split(sep).join("/");
}

const expectedAssets = BUILTIN_PACKS.flatMap((pack) => [
  `build/grammars/${pack.grammar.name}.wasm`,
  ...pack.queries.map((q) => packagePath(q.path)),
]);

interface LoadReport {
  ids: string[];
  modes: Record<string, string>;
  queriesPresent: boolean;
  missingNotice: string | undefined;
}

describe("packed @n-dx/sourcevision tarball", () => {
  let work: string;
  let packed = new Set<string>();
  let extracted = "";

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "sv-packed-"));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  /** Fail first, and plainly, when dist lacks a module that src/language has. */
  function requireFreshDist(): void {
    const build = "run `pnpm --filter @n-dx/sourcevision build`";
    if (!existsSync(join(PACKAGE_ROOT, "dist", "language", "pack.js"))) {
      throw new Error(`dist is not built — ${build}`);
    }
    const missing = readdirSync(join(PACKAGE_ROOT, "src", "language"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `${f.slice(0, -3)}.js`)
      .filter((f) => !existsSync(join(PACKAGE_ROOT, "dist", "language", f)));
    if (missing.length > 0) {
      throw new Error(`dist is older than src/language: dist/language lacks ${missing.join(", ")} — ${build}`);
    }
  }

  function pack(): void {
    if (extracted) return;
    requireFreshDist();
    // pnpm, not npm: npm runs `prepare` on pack and would rebuild dist mid-suite.
    const out = execFileSync("pnpm", ["pack", "--json", "--pack-destination", work], {
      cwd: PACKAGE_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: true,
    });
    const report = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
      filename: string;
      files: { path: string }[];
    };
    packed = new Set(report.files.map((f) => f.path));

    const install = join(work, "install");
    mkdirSync(install);
    execFileSync("tar", ["-xzf", report.filename, "-C", install], { cwd: work });
    extracted = join(install, "package");
    // Dependencies come from the workspace; the package's own files come only from the tarball.
    symlinkSync(join(PACKAGE_ROOT, "node_modules"), join(extracted, "node_modules"), "junction");
  }

  function requireGrammars(ctx: Parameters<typeof skipUnlessGrammar>[0]): void {
    for (const p of BUILTIN_PACKS) skipUnlessGrammar(ctx, join(grammarBuildDir(), `${p.grammar.name}.wasm`));
  }

  it("contains every built-in pack's grammar WASM and query files, and no build scratch", (ctx) => {
    requireGrammars(ctx);
    pack();

    expect(expectedAssets.length).toBeGreaterThan(0);
    for (const asset of expectedAssets) expect(packed, asset).toContain(asset);
    const scratch = [...packed].filter((f) => f.startsWith("build/") && !f.startsWith("build/grammars/"));
    expect(scratch).toEqual([]);
  });

  it("reports structure mode for every built-in pack when loaded from the installed tarball", (ctx) => {
    requireGrammars(ctx);
    pack();

    const emptyGrammarDir = join(work, "no-grammars");
    mkdirSync(emptyGrammarDir, { recursive: true });
    const script = `
      import { existsSync } from "node:fs";
      const { BUILTIN_PACKS, loadLanguagePacks } = await import(${JSON.stringify(
        pathToFileURL(join(extracted, "dist", "language", "pack.js")).href,
      )});
      const statuses = loadLanguagePacks({ warn: () => {} });
      const [missing] = loadLanguagePacks({ grammarDir: ${JSON.stringify(emptyGrammarDir)}, warn: () => {} });
      console.log(JSON.stringify({
        ids: BUILTIN_PACKS.map((p) => p.id),
        modes: Object.fromEntries(statuses.map((s) => [s.pack.id, s.mode])),
        queriesPresent: BUILTIN_PACKS.every((p) => p.queries.every((q) => existsSync(q.path))),
        missingNotice: missing?.notice,
      }));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: work,
      encoding: "utf-8",
    });
    const report = JSON.parse(out) as LoadReport;

    // A dist built before src/language/pack.ts registered a pack has every module file
    // but the old registry; say so rather than report it as a mode mismatch.
    const unregistered = BUILTIN_PACKS.map((p) => p.id).filter((id) => !report.ids.includes(id));
    if (unregistered.length > 0) {
      throw new Error(
        `dist is older than src/language: dist's BUILTIN_PACKS lacks ${unregistered.join(", ")} — run \`pnpm --filter @n-dx/sourcevision build\``,
      );
    }

    expect(report.modes).toEqual(Object.fromEntries(BUILTIN_PACKS.map((p) => [p.id, "structure"])));
    expect(report.modes["java"]).toBe("structure");
    expect(report.queriesPresent).toBe(true);
    // Published installs have no build script, so the notice must not point at one.
    expect(report.missingNotice).toContain("npm install -g @n-dx/core@latest");
    expect(report.missingNotice).not.toContain("build:grammars");
  });
});
