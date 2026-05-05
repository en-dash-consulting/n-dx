/**
 * Regression: prevents the @n-dx/core publish from shipping without its asset
 * data. The data directory must live inside the package (so npm's `files` can
 * include it) and must actually appear in the npm pack manifest.
 *
 * If this test fails, a published install will throw ENOENT in
 * `packages/core/assistant-assets.js` when it tries to read `manifest.json`.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CORE_DIR = join(import.meta.dirname, "../../packages/core");
const ASSET_DIR = join(CORE_DIR, "assistant-assets");

describe("@n-dx/core publishes assistant-assets/", () => {
  it("asset directory is colocated inside the package", () => {
    expect(existsSync(ASSET_DIR)).toBe(true);
    expect(existsSync(join(ASSET_DIR, "manifest.json"))).toBe(true);
    expect(existsSync(join(ASSET_DIR, "skills"))).toBe(true);
    expect(existsSync(join(ASSET_DIR, "project-guidance.md"))).toBe(true);
    expect(existsSync(join(ASSET_DIR, "claude-addendum.md"))).toBe(true);
    expect(existsSync(join(ASSET_DIR, "codex-troubleshooting.md"))).toBe(true);
  });

  it("package.json `files` array includes the asset directory", () => {
    const pkg = JSON.parse(readFileSync(join(CORE_DIR, "package.json"), "utf-8"));
    const includesAssets = pkg.files.some(
      (entry) => entry === "assistant-assets" || entry === "assistant-assets/",
    );
    expect(includesAssets).toBe(true);
  });

  it("`npm pack --dry-run` ships manifest.json and at least one skill", () => {
    const out = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json"],
      { cwd: CORE_DIR, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const [report] = JSON.parse(out);
    const shipped = new Set(report.files.map((f) => f.path));
    expect(shipped.has("assistant-assets/manifest.json")).toBe(true);
    expect(
      [...shipped].some((p) => p.startsWith("assistant-assets/skills/") && p.endsWith(".md")),
    ).toBe(true);
    expect(shipped.has("assistant-assets/project-guidance.md")).toBe(true);
    expect(shipped.has("assistant-assets/claude-addendum.md")).toBe(true);
    expect(shipped.has("assistant-assets/codex-troubleshooting.md")).toBe(true);
  });

  it("ASSET_DIR resolves to a path inside the core package", () => {
    const src = readFileSync(join(CORE_DIR, "assistant-assets.js"), "utf-8");
    // The resolver must point at a sibling directory of assistant-assets.js,
    // not a path that escapes packages/core/. ../../assistant-assets is the
    // historical bug — it works from the monorepo root but ENOENTs when the
    // package is installed at node_modules/@n-dx/core/.
    expect(src).not.toMatch(/resolve\(\s*__dir\s*,\s*["']\.\.\/\.\.\/assistant-assets/);
  });
});
