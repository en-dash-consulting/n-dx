/**
 * Finding a language pack: the per-user pack directory first, then module
 * resolution; a missing pack, a pack of another version and a module that is
 * no pack entry each come back as a notice naming the install command.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { javaConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { resolveNdxHome } from "@n-dx/llm-client";
import { INSTALLABLE_PACKS, KNOWN_PACKS, defaultPackDir, loadPack, packInstallCommand, type KnownPack } from "../../../src/language/pack-loader.js";
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

describe("workspace tests and scripts versus the user's pack directory", () => {
  const java = () => KNOWN_PACKS.find((p) => p.id === "java")!;

  /** Plant a pack of sourcevision's version in `<ndx home>/packs/<version>` that throws when imported. */
  function plantBrokenJavaPack(): string {
    const version = sourcevisionVersion();
    const dir = join(defaultPackDir(version), "node_modules", "@n-dx", "lang-java");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@n-dx/lang-java", version, main: "index.js" }));
    writeFileSync(join(dir, "index.js"), `throw new Error("planted pack must not be loaded");\n`);
    return defaultPackDir(version);
  }

  it("starts every test from an ndx home with no packs, not the developer's", () => {
    expect(resolveNdxHome().startsWith(tmpdir())).toBe(true);
    expect(existsSync(join(defaultPackDir(), "node_modules"))).toBe(false);
  });

  it("sets the ndx home up once per worker, however many files the worker runs", async () => {
    const home = process.env["NDX_HOME"];
    const listeners = process.listenerCount("exit");
    // The shared project re-runs setupFiles before each file in the same process.
    vi.resetModules();
    await import("../../setup-ndx-home.ts");
    expect(process.env["NDX_HOME"]).toBe(home);
    expect(process.listenerCount("exit")).toBe(listeners);
  });

  it("keeps a pack planted in the ndx home out of the corpus scripts' loader", async () => {
    const planted = plantBrokenJavaPack();
    try {
      // Control: the default loader does read the planted directory.
      expect((await loadPack(java())).status).toBe("invalid");
      const { workspaceLoader } = (await import("../../../scripts/workspace-pack.mjs")) as { workspaceLoader: { packDir: string } };
      expect(await loadPack(java(), workspaceLoader)).toMatchObject({ status: "loaded", source: "resolution" });
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }
  });
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
        remedy: "Install it with `ndx sv pack add java`.",
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
      found: "1.0.0",
      notice: {
        reason: `pack @n-dx/lang-java@1.0.0 does not match @n-dx/sourcevision@${VERSION} and was not used`,
        remedy: "Install the matching pack with `ndx sv pack add java`.",
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

describe("loadPack after an n-dx upgrade", () => {
  const packsRoot = (): string => join(resolveNdxHome(), "packs");
  afterEach(() => rmSync(packsRoot(), { recursive: true, force: true }));

  /** Install a Java pack package.json for `version` in that version's pack directory. */
  function installForVersion(dirVersion: string, manifestVersion: string = dirVersion): void {
    const dir = join(packsRoot(), dirVersion, "node_modules", "@n-dx", "lang-java");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@n-dx/lang-java", version: manifestVersion }));
  }

  it("refuses a pack installed only for another sourcevision version, rather than calling it missing", async () => {
    installForVersion("1.2.2");
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load).toEqual({
      status: "mismatch",
      found: "1.2.2",
      notice: {
        reason: `pack @n-dx/lang-java@1.2.2 does not match @n-dx/sourcevision@${VERSION} and was not used`,
        remedy: "Install the matching pack with `ndx sv pack add java`.",
      },
    });
  });

  it("names the newest of several stale installs", async () => {
    installForVersion("1.2.0");
    installForVersion("1.10.0");
    installForVersion("1.9.0");
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load).toMatchObject({ status: "mismatch", found: "1.10.0" });
  });

  it("still reports a pack missing when no version directory has it", async () => {
    mkdirSync(join(packsRoot(), "1.2.2", "node_modules"), { recursive: true });
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load.status).toBe("missing");
  });

  it("reports a pack missing, not rejecting, when the packs root is a file and cannot be listed", async () => {
    mkdirSync(resolveNdxHome(), { recursive: true });
    writeFileSync(packsRoot(), "not a directory");
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load.status).toBe("missing");
  });

  it("ignores a copy left in a `.sv-pack-stage-*` directory", async () => {
    installForVersion(".sv-pack-stage-x", "1.2.2");
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load.status).toBe("missing");
  });

  it("does not call a sibling copy of sourcevision's own version a mismatch", async () => {
    installForVersion("copy", VERSION);
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { version: VERSION });
    expect(load.status).toBe("missing");
  });

  it("reports a staged load whose bundle lacks the package as missing, not as the installed version", async () => {
    installForVersion(VERSION);
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), {
      packDir: join(packsRoot(), ".sv-pack-stage-y"),
      version: VERSION,
    });
    expect(load.status).toBe("missing");
  });

  it("does not blame a previous version's install for a staged load whose bundle lacks the package", async () => {
    installForVersion("1.2.2");
    const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), {
      packDir: join(packsRoot(), ".sv-pack-stage-z"),
      version: VERSION,
    });
    expect(load.status).toBe("missing");
  });

  it("does not look beside a pack directory that is not under the ndx home", async () => {
    const outside = mkdtempSync(join(tmpdir(), "sv-pack-parent-"));
    try {
      const sibling = join(outside, "1.2.2", "node_modules", "@n-dx", "lang-java");
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(sibling, "package.json"), JSON.stringify({ name: "@n-dx/lang-java", version: "1.2.2" }));
      const load = await loadPack(known(() => Promise.reject(notFound("@n-dx/lang-java"))), { packDir: join(outside, VERSION), version: VERSION });
      expect(load.status).toBe("missing");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("pack locations", () => {
  it("keeps opt-in packs under the ndx home, per sourcevision version", () => {
    expect(defaultPackDir("1.2.3")).toBe(join(resolveNdxHome(), "packs", "1.2.3"));
  });

  it("names the sv pack add command for a pack, not a raw npm command", () => {
    expect(INSTALLABLE_PACKS.map(packInstallCommand)).toEqual([
      "ndx sv pack add java",
      "ndx sv pack add go",
      "ndx sv pack add terraform",
      "ndx sv pack add python",
      "ndx sv pack add sql",
    ]);
  });
});

describe("known packs in the workspace", () => {
  it("loads the Java, Go and Terraform packs by module resolution, at sourcevision's version", async () => {
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
