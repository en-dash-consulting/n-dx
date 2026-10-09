import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

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

  /**
   * A stand-in `pnpm` first on PATH. It logs its arguments; with FAKE_PNPM=build it
   * stamps each --filter package's dist/ as a full build, with fail it exits 1 after
   * printing, with noop it does nothing. Suites (`run test`) are not exercised: the
   * gate either stops before them or the fake exits 0 for them.
   */
  const installFakePnpm = () => {
    const bin = join(root, "fakebin");
    const impl = join(bin, "pnpm-impl.mjs");
    write(
      "fakebin/pnpm-impl.mjs",
      `import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeBuildStamp } from ${JSON.stringify(pathToFileURL(join(root, "scripts/lib/stale-dist.mjs")).href)};
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, "pnpm-calls.log"))}, JSON.stringify(args) + "\\n");
if (!args.includes("build")) process.exit(0);
if (process.env.FAKE_PNPM === "fail") { console.error("tsc: boom"); process.exit(1); }
if (process.env.FAKE_PNPM === "build") {
  args.forEach((a, i) => {
    if (args[i - 1] !== "--filter") return;
    const dir = a.replace("@n-dx/", "");
    const dist = join(${JSON.stringify(root)}, "packages", dir, "dist");
    mkdirSync(dist, { recursive: true });
    writeBuildStamp(join(${JSON.stringify(root)}, "packages", dir, "src"), dist);
  });
}
`,
      0,
    );
    write("fakebin/pnpm", `#!/bin/sh\nexec "${process.execPath}" "${impl}" "$@"\n`, 0);
    chmodSync(join(bin, "pnpm"), 0o755);
    write("fakebin/pnpm.cmd", `@"${process.execPath}" "${impl}" %*\r\n`, 0);
    return bin;
  };
  const pnpmCalls = () => {
    try {
      return readFileSync(join(root, "pnpm-calls.log"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  const gate = (mode = "noop", extra = []) =>
    spawnSync(process.execPath, [join(root, "scripts/run-all-tests.mjs"), "affected", "HEAD", ...extra], {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        FAKE_PNPM: mode,
        PATH: `${installFakePnpm()}${delimiter}${process.env.PATH}`,
      },
    });
  const editSource = () => write("packages/llm-client/src/config.ts", "export const MODEL = 'new';\n", 0);

  it("builds exactly the stale packages in one pnpm call, names them, and re-checks the stamp", () => {
    editSource();
    const result = gate("build");
    expect(result.stdout).toContain("test-gate: rebuilt @n-dx/llm-client");
    expect(result.stdout).not.toContain("stale-dist=");
    const builds = pnpmCalls().filter((a) => a.includes("build"));
    expect(builds).toEqual([["--filter", "@n-dx/llm-client", "run", "build"]]);
  });

  it("fails with the build output and the stale-dist line when the build fails", () => {
    editSource();
    const result = gate("fail");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("@n-dx/llm-client");
    expect(result.stderr).toContain("tsc: boom");
    expect(result.stdout).toContain("test-gate: stale-dist=llm-client");
    expect(result.stdout).not.toContain("────────");
  });

  it("fails when a package is still stale after its build", () => {
    editSource();
    const result = gate("noop");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Still stale after the build");
    expect(result.stdout).toContain("test-gate: stale-dist=llm-client");
  });

  it("builds nothing when every stamp is current", () => {
    editSource();
    gate("build");
    rmSync(join(root, "pnpm-calls.log"), { force: true });
    gate("fail");
    expect(pnpmCalls().filter((a) => a.includes("build"))).toEqual([]);
  });

  it("lists the selection without checking or building", () => {
    editSource();
    const result = gate("fail", ["--list"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("test-gate: selected-suites=");
    expect(pnpmCalls()).toEqual([]);
  });
});
