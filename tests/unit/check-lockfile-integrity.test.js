/**
 * Supply-chain gate — the controls in .npmrc have to stay nameable, not assumed.
 *
 * `ignore-scripts` and `minimum-release-age` are the two settings standing
 * between a compromised npm publish and this machine, and both live in a
 * four-line config file that no test watched. A PR could have dropped either
 * one, or pointed a lockfile entry at a git URL that neither setting governs,
 * and every check in CI would still have been green.
 *
 * These tests pin the gate itself: each class of finding has to fire on a
 * workspace that deserves it, and the real repository has to stay clean.
 *
 * @see scripts/check-lockfile-integrity.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  findSupplyChainIssues,
  MIN_RELEASE_AGE_FLOOR_MINUTES,
} from "../../scripts/check-lockfile-integrity.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A workspace that passes every check, so each test changes exactly one thing. */
async function scaffold(root, overrides = {}) {
  const {
    lockfile = "lockfileVersion: '9.0'\n",
    npmrc = `ignore-scripts=true\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES}\n`,
    rootScripts = {},
    packageScripts = {},
  } = overrides;

  await writeFile(join(root, "pnpm-lock.yaml"), lockfile, "utf-8");
  await writeFile(join(root, ".npmrc"), npmrc, "utf-8");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-root", scripts: rootScripts }, null, 2),
    "utf-8",
  );
  const pkgDir = join(root, "packages", "thing");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@fixture/thing", scripts: packageScripts }, null, 2),
    "utf-8",
  );
}

const codes = (findings) => findings.map((f) => f.message);
const mentions = (findings, text) => codes(findings).some((m) => m.includes(text));

describe("findSupplyChainIssues", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "supply-chain-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports nothing for a workspace with the controls in force", async () => {
    await scaffold(root);
    expect(findSupplyChainIssues(root)).toEqual([]);
  });

  // The whole point of the gate: ignore-scripts and minimum-release-age only
  // govern packages fetched from the registry. A git or tarball resolution
  // waits out no release age and passes through no publish.
  it.each([
    ["tarball", "  evil@1.0.0:\n    resolution: {tarball: https://evil.test/x.tgz}\n"],
    ["git", "  evil@1.0.0:\n    resolution: {type: git, repo: git://evil.test/x}\n"],
    ["directory", "  evil@1.0.0:\n    resolution: {directory: ../../elsewhere, type: directory}\n"],
  ])("flags a %s resolution", async (_label, entry) => {
    await scaffold(root, { lockfile: `lockfileVersion: '9.0'\npackages:\n${entry}` });
    expect(mentions(findSupplyChainIssues(root), "Non-registry resolution")).toBe(true);
  });

  it.each([
    "git+https://evil.test/bar.git",
    "https://evil.test/bar.tgz",
    "file:../../../elsewhere",
  ])("flags a dependency specified as %s", async (spec) => {
    await scaffold(root, {
      lockfile: `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      bar:\n        specifier: ${spec}\n`,
    });
    expect(mentions(findSupplyChainIssues(root), "resolved outside the registry")).toBe(true);
  });

  // Workspace links are legitimate; one that climbs out of the checkout points
  // at whatever happened to sit beside it on the machine that installed.
  it("accepts a workspace link but flags one that escapes the repository", async () => {
    await scaffold(root, {
      lockfile: "lockfileVersion: '9.0'\nimporters:\n  packages/thing:\n    dependencies:\n      sib:\n        version: link:../other\n",
    });
    expect(findSupplyChainIssues(root)).toEqual([]);

    await scaffold(root, {
      lockfile: "lockfileVersion: '9.0'\nimporters:\n  packages/thing:\n    dependencies:\n      sib:\n        version: link:../../../outside\n",
    });
    expect(mentions(findSupplyChainIssues(root), "escapes the repository")).toBe(true);
  });

  // A format this scanner does not understand must fail, not pass quietly: the
  // patterns above are the only reason a textual scan is safe at all.
  it("fails closed on an unrecognised lockfileVersion", async () => {
    await scaffold(root, { lockfile: "lockfileVersion: '10.0'\n" });
    expect(mentions(findSupplyChainIssues(root), "is not one this check understands")).toBe(true);
  });

  it("reports a missing lockfile rather than passing with nothing to scan", async () => {
    await scaffold(root);
    await rm(join(root, "pnpm-lock.yaml"));
    expect(mentions(findSupplyChainIssues(root), "Lockfile is missing")).toBe(true);
  });

  it("requires ignore-scripts to stay true", async () => {
    await scaffold(root, { npmrc: `ignore-scripts=false\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES}\n` });
    expect(mentions(findSupplyChainIssues(root), "ignore-scripts must stay true")).toBe(true);
  });

  it.each([
    ["absent", "ignore-scripts=true\n"],
    ["below the floor", `ignore-scripts=true\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES - 1}\n`],
    ["not a number", "ignore-scripts=true\nminimum-release-age=soon\n"],
  ])("requires a meaningful minimum-release-age when %s", async (_label, npmrc) => {
    await scaffold(root, { npmrc });
    expect(mentions(findSupplyChainIssues(root), "minimum-release-age must be at least")).toBe(true);
  });

  it("flags a redirected registry, by bare key or by scope", async () => {
    await scaffold(root, {
      npmrc: `ignore-scripts=true\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES}\nregistry=https://evil.test/\n`,
    });
    expect(mentions(findSupplyChainIssues(root), "Registry is not")).toBe(true);

    await scaffold(root, {
      npmrc: `ignore-scripts=true\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES}\n@n-dx:registry=https://evil.test/\n`,
    });
    expect(mentions(findSupplyChainIssues(root), "Registry is not")).toBe(true);
  });

  it("ignores comments in .npmrc rather than parsing them as settings", async () => {
    await scaffold(root, {
      npmrc: `# registry=https://evil.test/\n; ignore-scripts=false\nignore-scripts=true\nminimum-release-age=${MIN_RELEASE_AGE_FLOOR_MINUTES}\n`,
    });
    expect(findSupplyChainIssues(root)).toEqual([]);
  });

  // ignore-scripts protects this repository's own installs. It does nothing
  // for someone installing a published @n-dx package, so the invariant that
  // no package ships an install hook has to be checked where it is authored.
  it.each(["preinstall", "install", "postinstall"])("flags a %s script in a workspace package", async (name) => {
    await scaffold(root, { packageScripts: { [name]: "node evil.js" } });
    const findings = findSupplyChainIssues(root);
    expect(mentions(findings, `Declares a "${name}" script`)).toBe(true);
    expect(findings[0].file).toBe("packages/thing/package.json");
  });

  it("flags an install script in the root package too", async () => {
    await scaffold(root, { rootScripts: { postinstall: "node evil.js" } });
    expect(mentions(findSupplyChainIssues(root), 'Declares a "postinstall" script')).toBe(true);
  });

  it("leaves prepare alone, which is how the packages compile on publish", async () => {
    await scaffold(root, { packageScripts: { prepare: "tsc" }, rootScripts: { prepare: "tsc" } });
    expect(findSupplyChainIssues(root)).toEqual([]);
  });
});

describe("the n-dx repository itself", () => {
  it("passes its own supply-chain gate", () => {
    expect(findSupplyChainIssues(REPO_ROOT)).toEqual([]);
  });
});
