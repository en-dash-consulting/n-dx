/**
 * Finding a language pack: the per-user pack directory first, then module
 * resolution; a missing pack, a pack of another version and a module that is
 * no pack entry each come back as a notice naming the install command.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { javaConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { resolveNdxHome } from "@n-dx/llm-client";
import { KNOWN_PACKS, defaultPackDir, loadPack, packInstallCommand, type KnownPack } from "../../../src/language/pack-loader.js";
import { sourcevisionVersion } from "../../../src/language/package-paths.js";

const VERSION = "1.2.3";

const entry = (overrides: Partial<LanguagePackEntry> = {}): LanguagePackEntry => ({
  packageName: "@n-dx/lang-java",
  version: VERSION,
  id: "java",
  config: javaConfig,
  produces: ["imports"],
  analyzeProject: async () => ({ facts: [], unparsed: [] }),
  ...overrides,
});

const notFound = (name: string): Error =>
  Object.assign(new Error(`Cannot find package '${name}' imported from /somewhere/pack-loader.js`), { code: "ERR_MODULE_NOT_FOUND" });

const known = (importByResolution: () => Promise<unknown>): KnownPack => ({
  id: "java",
  packageName: "@n-dx/lang-java",
  config: javaConfig,
  importByResolution,
});

describe("loadPack", () => {
  let packDir: string;
  beforeEach(() => {
    packDir = mkdtempSync(join(tmpdir(), "sv-pack-dir-"));
  });
  afterEach(() => rmSync(packDir, { recursive: true, force: true }));

  /** Install a package.json for the Java pack in the pack directory. */
  function installInPackDir(manifest: Record<string, unknown>): string {
    const dir = join(packDir, "node_modules", "@n-dx", "lang-java");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    return dir;
  }

  it("loads a pack from the pack directory before trying module resolution", async () => {
    const dir = installInPackDir({ name: "@n-dx/lang-java", version: VERSION, exports: { ".": { import: "./dist/index.js" } } });
    const imported: string[] = [];
    const found = entry();
    const load = await loadPack(
      known(() => Promise.reject(new Error("resolution must not be tried"))),
      { packDir, version: VERSION, importFile: async (url) => (imported.push(url), { pack: found }) },
    );
    expect(load).toEqual({ status: "loaded", entry: found, source: "pack-dir" });
    expect(imported).toEqual([pathToFileURL(join(dir, "dist", "index.js")).href]);
  });

  it("loads a pack through module resolution when the pack directory does not have it", async () => {
    const found = entry();
    const load = await loadPack(known(async () => ({ pack: found })), { packDir, version: VERSION });
    expect(load).toEqual({ status: "loaded", entry: found, source: "resolution" });
  });

  it("reports a missing pack once, naming the command that installs it into the pack directory", async () => {
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { packDir, version: VERSION });
    expect(load).toEqual({
      status: "missing",
      notice: {
        reason: "pack @n-dx/lang-java is not installed",
        remedy: `Install it with \`npm install --prefix ${packDir} @n-dx/lang-java@${VERSION}\`.`,
      },
    });
  });

  it("refuses a pack in the pack directory whose version is not sourcevision's, without importing it", async () => {
    installInPackDir({ name: "@n-dx/lang-java", version: "1.0.0", exports: "./index.js" });
    const load = await loadPack(known(async () => ({ pack: entry() })), {
      packDir,
      version: VERSION,
      importFile: () => Promise.reject(new Error("a mismatched pack must not be imported")),
    });
    expect(load).toEqual({
      status: "mismatch",
      notice: {
        reason: `pack @n-dx/lang-java@1.0.0 does not match @n-dx/sourcevision@${VERSION} and was not used`,
        remedy: `Install the matching pack with \`npm install --prefix ${packDir} @n-dx/lang-java@${VERSION}\`.`,
      },
    });
  });

  it("refuses a resolved pack whose entry carries another version", async () => {
    const load = await loadPack(known(async () => ({ pack: entry({ version: "1.0.0" }) })), { packDir, version: VERSION });
    expect(load.status).toBe("mismatch");
  });

  it("reports a module that exports no pack entry for the language", async () => {
    const load = await loadPack(known(async () => ({ pack: entry({ id: "go" }) })), { packDir, version: VERSION });
    expect(load).toMatchObject({ status: "invalid", notice: { reason: "pack @n-dx/lang-java could not be loaded (it exports no java pack entry)" } });
  });

  it("reports a pack that is installed but fails to import, rather than calling it missing", async () => {
    const load = await loadPack(known(() => Promise.reject(notFound("web-tree-sitter"))), { packDir, version: VERSION });
    expect(load.status).toBe("invalid");
  });
});

describe("pack locations", () => {
  it("keeps opt-in packs under the ndx home, per sourcevision version", () => {
    expect(defaultPackDir("1.2.3")).toBe(join(resolveNdxHome(), "packs", "1.2.3"));
  });

  it("quotes a pack directory with spaces in the install command", () => {
    expect(packInstallCommand(KNOWN_PACKS[0]!, "/Users/a b/.ndx/packs/1.2.3", "1.2.3")).toBe(
      'npm install --prefix "/Users/a b/.ndx/packs/1.2.3" @n-dx/lang-java@1.2.3',
    );
  });
});

describe("known packs in the workspace", () => {
  it("loads the Java and Go packs by module resolution, at sourcevision's version", async () => {
    const emptyPackDir = mkdtempSync(join(tmpdir(), "sv-pack-dir-"));
    try {
      for (const pack of KNOWN_PACKS) {
        const load = await loadPack(pack, { packDir: emptyPackDir });
        expect(load.status, pack.packageName).toBe("loaded");
        if (load.status !== "loaded") continue;
        expect(load.source).toBe("resolution");
        expect(load.entry).toMatchObject({ id: pack.id, packageName: pack.packageName, version: sourcevisionVersion() });
      }
    } finally {
      rmSync(emptyPackDir, { recursive: true, force: true });
    }
  });
});
