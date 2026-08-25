/**
 * Dependency-drift check — a stale node_modules must be nameable, not silent.
 *
 * Observed 2026-08-24: `pnpm typecheck` failed on a valid `scrollMargin`
 * assertion because packages/web's installed typescript was 5.9.3 against a
 * declared ^6.0.3 — an error CI (fresh install) did not have. Nothing compared
 * resolved versions against declared ranges, so the red typecheck read as a
 * real type error and nearly got a correct test "fixed". The check these tests
 * pin walks every workspace package.json and reports any dependency whose
 * installed version does not satisfy its declared range.
 *
 * @see scripts/check-dependency-drift.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findDependencyDrift } from "../../scripts/check-dependency-drift.mjs";

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

/** Lay out a minimal workspace: a root and one package, each with a node_modules. */
async function scaffold(root, { declared, installed }) {
  await writeJson(join(root, "package.json"), {
    name: "fixture-root",
    devDependencies: { typescript: declared },
  });
  const pkgDir = join(root, "packages", "web");
  await mkdir(pkgDir, { recursive: true });
  await writeJson(join(pkgDir, "package.json"), {
    name: "@fixture/web",
    devDependencies: { typescript: declared },
  });
  if (installed) {
    await writeJson(join(root, "node_modules", "typescript", "package.json"), {
      name: "typescript",
      version: installed,
    });
  }
}

describe("findDependencyDrift", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dep-drift-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("names the package, declared range, and installed version on drift", async () => {
    // The observed incident: typescript resolves to 5.9.3 against ^6.0.3.
    await scaffold(root, { declared: "^6.0.3", installed: "5.9.3" });

    const drift = await findDependencyDrift(root);

    // Both the root and packages/web declare it, and both resolve to the same
    // stale hoisted install.
    expect(drift.length).toBeGreaterThanOrEqual(1);
    for (const entry of drift) {
      expect(entry.dependency).toBe("typescript");
      expect(entry.declared).toBe("^6.0.3");
      expect(entry.installed).toBe("5.9.3");
    }
    const owners = drift.map((d) => d.package);
    expect(owners).toContain("@fixture/web");
  });

  it("is silent on a correctly-installed tree", async () => {
    await scaffold(root, { declared: "^6.0.3", installed: "6.1.0" });
    expect(await findDependencyDrift(root)).toEqual([]);
  });

  it("treats a caret range as bounded by the major version", async () => {
    // ^6.0.3 must not accept 7.x — a too-new install misleads the same way.
    await scaffold(root, { declared: "^6.0.3", installed: "7.0.0" });
    const drift = await findDependencyDrift(root);
    expect(drift.length).toBeGreaterThanOrEqual(1);
  });

  it("skips workspace links and dependencies that are not installed", async () => {
    await writeJson(join(root, "package.json"), {
      name: "fixture-root",
      dependencies: {
        "@fixture/sibling": "workspace:*",
        "left-pad": "^1.3.0", // declared but absent: a fresh clone, not drift
      },
    });
    expect(await findDependencyDrift(root)).toEqual([]);
  });

  it("prefers the package-local install over the hoisted one", async () => {
    await scaffold(root, { declared: "^6.0.3", installed: "5.9.3" });
    // packages/web has its own, correct copy — only the root should drift.
    await writeJson(
      join(root, "packages", "web", "node_modules", "typescript", "package.json"),
      { name: "typescript", version: "6.0.3" },
    );

    const drift = await findDependencyDrift(root);
    const owners = drift.map((d) => d.package);
    expect(owners).toContain("fixture-root");
    expect(owners).not.toContain("@fixture/web");
  });
});

describe("range handling", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dep-drift-ranges-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function withInstall(declared, installed) {
    await writeJson(join(root, "package.json"), {
      name: "fixture-root",
      dependencies: { dep: declared },
    });
    await writeJson(join(root, "node_modules", "dep", "package.json"), {
      name: "dep",
      version: installed,
    });
    return findDependencyDrift(root);
  }

  it("tilde bounds the minor version", async () => {
    expect(await withInstall("~1.2.3", "1.2.9")).toEqual([]);
    expect((await withInstall("~1.2.3", "1.3.0")).length).toBe(1);
  });

  it("exact versions must match exactly", async () => {
    expect(await withInstall("1.2.3", "1.2.3")).toEqual([]);
    expect((await withInstall("1.2.3", "1.2.4")).length).toBe(1);
  });

  it("an unrecognized range is skipped rather than false-positived", async () => {
    expect(await withInstall("git+https://example.com/dep.git", "0.0.1")).toEqual([]);
  });
});
