import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dirname, "../../scripts/run-all-tests.mjs");

/** `--list` prints the selection and exits without running any suite. */
function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
}

describe("run-all-tests.mjs suite selection", () => {
  it("exits 2 and lists the valid labels for an unknown label", () => {
    const result = run("root,bogus");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"bogus"');
    for (const label of ["root", "rex", "hench", "web", "llm-client", "sourcevision"]) {
      expect(result.stderr).toContain(label);
    }
  });

  it("lists comma-separated labels in run order without running them", () => {
    const result = run("rex,root", "--list");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("test-gate: selected-suites=root,rex");
  });

  it("accepts space-separated labels and the scoped package name", () => {
    const result = run("@n-dx/web", "hench", "--list");
    expect(result.stdout.trim()).toBe("test-gate: selected-suites=hench,web");
  });

  it("keeps all and packages meanings", () => {
    expect(run("--list").stdout).toMatch(/selected-suites=root,.*web/);
    const packages = run("packages", "--list").stdout;
    expect(packages).toMatch(/selected-suites=/);
    expect(packages).not.toMatch(/selected-suites=root/);
  });

  // hench's rerunCommand feeds failed suite shorts straight back in, so every
  // label the runner can print must also be a label it accepts.
  it("accepts each root subset as a label, and drops them when root is also asked for", () => {
    expect(run("root-policy", "--list").stdout.trim()).toBe("test-gate: selected-suites=root-policy");
    expect(run("root-drift", "--list").stdout.trim()).toBe("test-gate: selected-suites=root-drift");
    expect(run("root-policy,root-drift", "--list").stdout.trim()).toBe(
      "test-gate: selected-suites=root-policy,root-drift",
    );
    expect(run("root-drift,root", "--list").stdout.trim()).toBe("test-gate: selected-suites=root");
  });

  it("falls back to every suite, with a warning, for an unresolvable base ref", () => {
    const result = run("affected", "no-such-ref-for-test-gate", "--list");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("falling back to running ALL suites");
    expect(result.stdout).toMatch(/selected-suites=root,.*rex.*web/);
    // root runs their files already; the fallback must not run them twice.
    expect(result.stdout).not.toContain("root-policy");
    expect(result.stdout).not.toContain("root-drift");
  });

  it("prints a reason per suite in affected mode", () => {
    const result = run("affected", "HEAD", "--list");
    const lines = result.stdout.trim().split("\n");
    const selected = lines[0].replace("test-gate: selected-suites=", "").split(",").filter(Boolean);
    const reasons = lines.filter((l) => l.startsWith("test-gate: reason "));
    expect(reasons).toHaveLength(selected.length);
  });

  it("requires a base ref for affected", () => {
    expect(run("affected").status).toBe(2);
  });
});

describe("run-all-tests.mjs affected gate on a stale build", () => {
  const REPO = join(import.meta.dirname, "../..");
  /** The runner and everything it imports, copied into a throwaway repository. */
  const RUNNER_FILES = [
    "scripts/run-all-tests.mjs",
    "scripts/lib/select-suites.mjs",
    "scripts/lib/stale-dist.mjs",
    "packages/core/win-spawn.js",
    "packages/core/cli-log.js",
  ];
  let root;

  const write = (rel, content, secondsAgo) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    const t = new Date(Date.now() - secondsAgo * 1000);
    utimesSync(full, t, t);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stale-gate-"));
    for (const rel of RUNNER_FILES) write(rel, readFileSync(join(REPO, rel), "utf-8"), 0);
    write(
      "packages/llm-client/package.json",
      JSON.stringify({ name: "@n-dx/llm-client", scripts: { test: "vitest run" } }),
      0,
    );
    write("packages/llm-client/src/config.ts", "export const MODEL = 'old';\n", 200);
    write("packages/llm-client/dist/config.js", "export const MODEL = 'old';\n", 100);
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const gate = () =>
    spawnSync(process.execPath, [join(root, "scripts/run-all-tests.mjs"), "affected", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
    });

  it("fails before running any suite, naming the package and its build command", () => {
    write("packages/llm-client/src/config.ts", "export const MODEL = 'new';\n", 0);
    const result = gate();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@n-dx/llm-client");
    expect(result.stderr).toContain("pnpm --filter @n-dx/llm-client build");
    expect(result.stdout).toContain("test-gate: stale-dist=llm-client");
    expect(result.stdout).not.toContain("────────");
  });

  it("lists the selection without the stale check", () => {
    write("packages/llm-client/src/config.ts", "export const MODEL = 'new';\n", 0);
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/run-all-tests.mjs"), "affected", "HEAD", "--list"],
      { cwd: root, encoding: "utf-8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test-gate: selected-suites=");
  });
});
