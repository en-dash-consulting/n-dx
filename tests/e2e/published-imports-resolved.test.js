/**
 * Regression: prevents a published package from shipping a JS file that
 * imports a relative path which is NOT itself included in the tarball.
 *
 * Origin: @n-dx/core@0.4.3 published with cli.js importing
 * ./self-heal-confirm.js, but the file was missing from package.json's
 * `files` array. `ndx --version` immediately threw ERR_MODULE_NOT_FOUND
 * for anyone who installed from npm. The publish workflow can't catch
 * this — npm only complains when the resolver actually runs at runtime.
 *
 * What this test does for every workspace package:
 *   1. Run `npm pack --dry-run --json` to get the exact file set that
 *      would be uploaded to the registry.
 *   2. For each .js/.mjs/.cjs file in that set, scan for relative
 *      imports (./ and ../) of every form: `import … from "./x.js"`,
 *      `import("./x.js")`, and `require("./x.js")`.
 *   3. Resolve each spec against the importing file's directory and
 *      try the spec as-is, then with `.js` appended, then as a
 *      directory `index.js`. If none of those land inside the packed
 *      file set, the import is unresolved.
 *
 * The test FAILS with a per-package summary of unresolved imports.
 * Bare-specifier imports (e.g. `import "react"`) and URL-style imports
 * are dependencies/runtime concerns and intentionally skipped.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, posix } from "path";

const REPO_ROOT = join(import.meta.dirname, "../..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

// Matches: `from "./x"`, `from '../y/z.js'`, `import("./a")`, `require('./b.js')`.
// Captures the relative specifier (must start with ./ or ../).
const RELATIVE_IMPORT_RE =
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

function listWorkspacePackages() {
  return readdirSync(PACKAGES_DIR).filter((name) => {
    try {
      return statSync(join(PACKAGES_DIR, name, "package.json")).isFile();
    } catch {
      return false;
    }
  });
}

function getPackedFiles(pkgDir) {
  // npm pack runs prepack/prepublish lifecycle scripts before emitting
  // the JSON report. Scripts may print `> @scope/pkg@x.y.z prepack …`
  // banners to stdout, so locate the first `[` (the JSON array start)
  // and parse from there.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkgDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(`npm pack --json produced no array output:\n${out}`);
  }
  const [report] = JSON.parse(out.slice(jsonStart));
  return new Set(report.files.map((f) => f.path));
}

function stripComments(src) {
  // Block comments first (non-greedy, multi-line friendly), then line
  // comments. Naive but adequate: `//` inside an unrelated string would
  // be over-stripped, but those lines never contain real import/require
  // statements, so we'd only lose noise.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function findUnresolvedImports(pkgDir, shipped) {
  const issues = [];
  for (const file of shipped) {
    if (!/\.(?:js|mjs|cjs)$/.test(file)) continue;
    let content;
    try {
      content = stripComments(readFileSync(join(pkgDir, file), "utf-8"));
    } catch {
      continue;
    }
    const fileDir = dirname(file);
    for (const m of content.matchAll(RELATIVE_IMPORT_RE)) {
      const spec = m[1];
      let base = posix.normalize(posix.join(fileDir, spec));
      if (base.startsWith("./")) base = base.slice(2);
      const candidates = [base];
      if (!/\.(?:js|mjs|cjs|json)$/.test(base)) {
        candidates.push(`${base}.js`, `${base}/index.js`);
      }
      if (!candidates.some((c) => shipped.has(c))) {
        issues.push({ file, spec, resolved: base });
      }
    }
  }
  return issues;
}

describe("Published tarballs contain every relative import target", () => {
  const packages = listWorkspacePackages();
  expect(packages.length).toBeGreaterThan(0);

  for (const pkgName of packages) {
    it(`${pkgName}: relative imports all resolve inside the tarball`, () => {
      const pkgDir = join(PACKAGES_DIR, pkgName);
      const shipped = getPackedFiles(pkgDir);
      const issues = findUnresolvedImports(pkgDir, shipped);
      if (issues.length > 0) {
        const detail = issues
          .map(
            (i) =>
              `  ${i.file} imports "${i.spec}" → "${i.resolved}" (not in tarball)`,
          )
          .join("\n");
        throw new Error(
          `${pkgName} has ${issues.length} unresolved relative import(s):\n${detail}\n\n` +
            `Either add the missing file(s) to package.json's "files" array, ` +
            `move them to a directory already covered by "files", or remove the import.`,
        );
      }
    });
  }
});
