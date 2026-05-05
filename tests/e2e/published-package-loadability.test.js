/**
 * Pack-and-load test: for each publishable workspace package, run `npm pack`,
 * extract the tarball, and load the result. Anything the source code reads at
 * runtime that isn't shipped in the tarball throws ENOENT and fails the test.
 *
 * This generalizes the `assistant-assets/manifest.json` ENOENT regression: any
 * future package that adds a runtime fs read pointing outside the tarball gets
 * caught here automatically — no allowlist or per-package wiring needed.
 *
 * Test slowness budget: ~3-5s per package (pack + extract + node load).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

function listPublishablePackages() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(PACKAGES_DIR, d.name);
      const pkgPath = join(dir, "package.json");
      if (!existsSync(pkgPath)) return null;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.private) return null;
      return { name: pkg.name, dirName: d.name, dir, pkg };
    })
    .filter(Boolean);
}

function packAndExtract(pkgDir) {
  const tmpRoot = mkdtempSync(join(tmpdir(), "ndx-pack-load-"));

  // `--ignore-scripts` skips `prepare`/`prepack` so the build banner doesn't
  // pollute stdout. The test runs against pre-built dist/ output (produced by
  // pnpm install / pnpm run build), since dist/ is what publish actually ships.
  const out = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", tmpRoot],
    { cwd: pkgDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const [report] = JSON.parse(out);
  const tgzPath = join(tmpRoot, report.filename);

  const extractDir = join(tmpRoot, "extracted");
  mkdirSync(extractDir);
  execFileSync(
    "tar",
    ["-xzf", tgzPath, "-C", extractDir, "--strip-components=1"],
    { stdio: "ignore" },
  );

  // Symlink the source package's node_modules so deps resolve during load.
  // The point of the test is to validate the package's OWN file bundling, not
  // to test transitive workspace deps — those come from the source tree.
  const srcNodeModules = join(pkgDir, "node_modules");
  if (existsSync(srcNodeModules)) {
    symlinkSync(srcNodeModules, join(extractDir, "node_modules"));
  }

  return { tmpRoot, extractDir, shippedFiles: report.files.map((f) => f.path) };
}

function runNode(args, options = {}) {
  return spawnSync("node", args, {
    encoding: "utf-8",
    timeout: 30_000,
    ...options,
  });
}

function getEsmEntry(pkg) {
  const dot = pkg.exports?.["."];
  if (typeof dot === "string") return dot;
  if (dot && typeof dot === "object") return dot.import || dot.default;
  return pkg.main;
}

const packages = listPublishablePackages();

describe("published-package loadability (pack + extract + import)", () => {
  for (const { name, dirName, dir, pkg } of packages) {
    describe(name, () => {
      let extractDir;
      let tmpRoot;
      let shippedFiles;

      beforeAll(() => {
        const result = packAndExtract(dir);
        extractDir = result.extractDir;
        tmpRoot = result.tmpRoot;
        shippedFiles = result.shippedFiles;
      });

      afterAll(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
      });

      const entry = getEsmEntry(pkg);

      if (entry) {
        it(`public entry "${entry}" imports without ENOENT`, () => {
          const entryPath = join(extractDir, entry);
          expect(existsSync(entryPath)).toBe(true);

          const result = runNode([
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(entryPath)});`,
          ]);

          if (result.status !== 0) {
            throw new Error(
              `Loading ${name} from packed tarball failed:\n` +
                `STDERR: ${result.stderr}\nSTDOUT: ${result.stdout}`,
            );
          }
        });
      }

      const binEntries = Object.entries(pkg.bin || {});
      // For `@n-dx/core`, several bin aliases point at the same file (rex/hench/sv
      // also map to sub-package CLIs). Dedupe by target path.
      const uniqueBinTargets = [...new Set(binEntries.map(([, p]) => p))];

      for (const binTarget of uniqueBinTargets) {
        it(`bin "${binTarget}" responds to --help without ENOENT`, () => {
          const binPath = join(extractDir, binTarget);
          if (!existsSync(binPath)) {
            // The core package's bin includes wrappers for sub-packages
            // (rex.js etc.); those are present and may delegate to deps.
            throw new Error(`Bin file not shipped: ${binTarget}`);
          }

          const result = runNode([binPath, "--help"]);

          // Some CLIs (the core wrappers for rex/hench/sv) shell out and may
          // legitimately exit non-zero on --help when the sub-package isn't
          // resolvable in the test isolation — but they should never ENOENT
          // on their own bundled files. Match on stderr instead of exit code.
          const combined = (result.stderr || "") + (result.stdout || "");
          const enoentMatch = combined.match(
            /ENOENT[^]*?at .*?(?:packed-tarball|extracted)/i,
          );
          // Loose check: the literal "Error: ENOENT" anywhere in stderr that
          // references a path inside the extracted tarball is a fail signal.
          const ownEnoent = (result.stderr || "").match(
            new RegExp(
              `ENOENT[^]*?${extractDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            ),
          );
          if (ownEnoent) {
            throw new Error(
              `Bin '${binTarget}' --help threw ENOENT for a tarball-internal path:\n${result.stderr}`,
            );
          }
        });
      }

      it("ships at least one .js file", () => {
        const jsFiles = shippedFiles.filter((f) => f.endsWith(".js"));
        expect(jsFiles.length).toBeGreaterThan(0);
      });
    });
  }

  // ── @n-dx/core asset-API exercise ──────────────────────────────────────────
  // This is the original bug surface. The generic "import the public entry"
  // check above does NOT catch it for core because core has no public ESM
  // exports — its assets are read by claude-integration.js / codex-integration.js
  // at module top level. We import those directly from the packed tarball to
  // reproduce the original ENOENT path.

  describe("@n-dx/core asset-loading paths", () => {
    let extractDir;
    let tmpRoot;

    beforeAll(() => {
      const corePkg = packages.find((p) => p.name === "@n-dx/core");
      if (!corePkg) return;
      const result = packAndExtract(corePkg.dir);
      extractDir = result.extractDir;
      tmpRoot = result.tmpRoot;
    });

    afterAll(() => {
      if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("assistant-assets.js getManifest() reads the bundled manifest", () => {
      const result = runNode([
        "--input-type=module",
        "-e",
        `
          const m = await import(${JSON.stringify(join(extractDir, "assistant-assets.js"))});
          const manifest = m.getManifest();
          if (!manifest.skills || Object.keys(manifest.skills).length === 0) {
            throw new Error("manifest.skills is empty");
          }
          // Touch every fs-reading API
          m.getProjectGuidance();
          m.getClaudeAddendum();
          m.getCodexTroubleshooting();
          m.renderClaudeMd();
          m.renderAgentsMd();
          for (const name of m.getSkillNames()) m.getSkillBody(name);
          process.stdout.write("ok:" + Object.keys(manifest.skills).length);
        `,
      ]);
      if (result.status !== 0) {
        throw new Error(
          `assistant-assets.js failed in packed tarball:\n${result.stderr}`,
        );
      }
      expect(result.stdout).toMatch(/^ok:\d+$/);
    });

    it("claude-integration.js loads (top-level read of manifest)", () => {
      const result = runNode([
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(join(extractDir, "claude-integration.js"))});`,
      ]);
      if (result.status !== 0) {
        throw new Error(
          `claude-integration.js failed in packed tarball:\n${result.stderr}`,
        );
      }
    });

    it("codex-integration.js loads (top-level read of manifest)", () => {
      const result = runNode([
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(join(extractDir, "codex-integration.js"))});`,
      ]);
      if (result.status !== 0) {
        throw new Error(
          `codex-integration.js failed in packed tarball:\n${result.stderr}`,
        );
      }
    });
  });
});
