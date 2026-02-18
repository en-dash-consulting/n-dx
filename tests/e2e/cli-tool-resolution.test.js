import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "../..");
const CLI_PATH = join(ROOT, "cli.js");

/**
 * Mirror the resolveToolPath logic used in cli.js to verify
 * that each package's bin field resolves to a real file.
 */
function resolveToolPath(pkgDir) {
  const pkgPath = join(ROOT, pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (typeof pkg.bin === "string") {
    return join(pkgDir, pkg.bin);
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    const first = Object.values(pkg.bin)[0];
    if (first) return join(pkgDir, first);
  }
  throw new Error(`No bin field in ${pkgPath}`);
}

describe("tool path resolution", () => {
  const packages = [
    { name: "rex", dir: "packages/rex" },
    { name: "hench", dir: "packages/hench" },
    { name: "sourcevision", dir: "packages/sourcevision" },
    { name: "web", dir: "packages/web" },
  ];

  for (const { name, dir } of packages) {
    it(`resolves ${name} CLI path from package.json bin field`, () => {
      const resolved = resolveToolPath(dir);
      // Path should point to a real file (dist must be built)
      const fullPath = join(ROOT, resolved);
      expect(() => readFileSync(fullPath)).not.toThrow();
    });
  }

  it("resolved paths match what cli.js uses for delegation", () => {
    // Verify that delegation works for each tool — if the path was wrong,
    // the child process would fail with a non-zero exit code
    for (const tool of ["rex", "hench", "sourcevision", "sv"]) {
      const output = execFileSync("node", [CLI_PATH, tool, "--help"], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
      expect(output.length).toBeGreaterThan(0);
    }
  }, 15000);
});
