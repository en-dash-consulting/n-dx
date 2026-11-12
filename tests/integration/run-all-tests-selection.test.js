import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireValidationSlot, resolveValidationSlotDir } from "../../scripts/lib/validation-slot.mjs";

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
    "scripts/lib/validation-slot.mjs",
    "scripts/lib/workspace-manifests.mjs",
    "packages/core/layout.js",
    "packages/core/build-identity.mjs",
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
if (!args.includes("build")) {
  // A suite that runs until it is stopped, after saying so and naming the slot token and directory it got.
  if (!process.env.FAKE_SUITE_MARKER) process.exit(0);
  appendFileSync(process.env.FAKE_SUITE_MARKER, JSON.stringify({ token: process.env.NDX_VALIDATION_SLOT, dir: process.env.NDX_VALIDATION_SLOT_DIR }));
  setInterval(() => {}, 1000);
} else {
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
  /**
   * The runner's environment. A suite run by a hench gate inherits the gate's
   * slot token and directory; the runner under test must see only those a
   * test gives it (tests/setup-ndx-home.js clears them too).
   */
  const gateEnv = (mode, extraEnv = {}) => {
    const { NDX_VALIDATION_SLOT: _token, NDX_VALIDATION_SLOT_DIR: _dir, ...base } = process.env;
    return {
      ...base,
      FAKE_PNPM: mode,
      PATH: `${installFakePnpm()}${delimiter}${process.env.PATH}`,
      ...extraEnv,
    };
  };
  const gate = (mode = "noop", extra = [], extraEnv = {}) =>
    spawnSync(process.execPath, [join(root, "scripts/run-all-tests.mjs"), "affected", "HEAD", ...extra], {
      cwd: root,
      encoding: "utf-8",
      env: gateEnv(mode, extraEnv),
      // A runner that waits for a slot it should not take fails here, not at the test timeout.
      timeout: 60_000,
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

  describe("host validation slot", () => {
    let home;
    let slotDir;
    let held;
    beforeEach(async () => {
      home = mkdtempSync(join(tmpdir(), "runner-slot-home-"));
      // This host's directory under that home; the runner resolves the same one.
      slotDir = await resolveValidationSlotDir({ N_DX_HOME: home });
      // The fake pnpm and the logs a run writes are untracked files that would
      // select root; ignored, an unedited tree selects no suite and the run exits 0.
      write(".gitignore", "fakebin/\npnpm-calls.log\nsuite-started\nclaude_commands.log\n.test-logs/\n", 0);
      // Root subsets run this script; the stand-in passes at once.
      write("scripts/run-vitest-bind-aware.mjs", "process.exit(0);\n", 0);
      git("add", ".gitignore", "scripts/run-vitest-bind-aware.mjs");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "ignore");
    });
    afterEach(async () => {
      await held?.release();
      held = undefined;
      rmSync(home, { recursive: true, force: true });
    });

    /** Hold the slot from this test process, as a hench gate or another runner would. */
    const hold = async () => {
      held = await acquireValidationSlot({ slotDir, projectDir: "/elsewhere", env: {} });
      return held;
    };
    const holderFile = () => join(slotDir, "holder.json");
    const readHolderRecord = () => JSON.parse(readFileSync(holderFile(), "utf-8"));
    // tests/setup-ndx-home.js clears NDX_HOME, so N_DX_HOME decides the ndx home.
    const homeEnv = (extra = {}) => ({ N_DX_HOME: home, ...extra });
    /**
     * A tests-only edit: selects llm-client and root-policy, both stand-ins
     * that pass at once, and nothing to rebuild. Without it nothing is
     * selected, and the runner does not take the slot.
     */
    const selectTinySuites = () => write("packages/llm-client/tests/unit/slot.test.ts", "\n", 0);

    /** Start the runner without waiting for it; `output()` is what it has printed so far. */
    const startGate = (mode, extraEnv = {}) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(process.execPath, [join(root, "scripts/run-all-tests.mjs"), "affected", "HEAD"], {
        cwd: root,
        env: gateEnv(mode, homeEnv(extraEnv)),
        windowsHide: true,
      });
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const done = new Promise((resolvePromise) =>
        child.on("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr })),
      );
      return { child, done, output: () => stdout };
    };

    it("waits while another process holds the slot, names the holder, and reports the queue time", async () => {
      selectTinySuites();
      await hold();
      const run = startGate("noop");
      await vi.waitFor(
        () => expect(run.output()).toContain(`Waiting for the validation slot held by pid ${process.pid} in /elsewhere since `),
        { timeout: 30_000, interval: 50 },
      );
      expect(run.output()).not.toContain("selected-suites=");
      await held.release();
      const result = await run.done;
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("test-gate: selected-suites=root-policy,llm-client");
      expect(result.stdout).toContain("2/2 suites passed");
      expect(result.stdout).toMatch(/Validation slot: queued \d+\.\ds/);
      expect(existsSync(holderFile())).toBe(false);
    });

    it("neither takes nor waits for the slot when nothing is selected and nothing needs rebuilding", async () => {
      const lease = await hold();
      const result = gate("noop", [], homeEnv());
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("test-gate: selected-suites=\n");
      expect(result.stdout).not.toContain("Waiting for the validation slot");
      expect(result.stdout).toContain("Validation slot: not taken (nothing to run)");
      expect(readHolderRecord().token).toBe(lease.token);
    });

    it("runs inside the holder's slot when NDX_VALIDATION_SLOT names that live holder", async () => {
      selectTinySuites();
      const lease = await hold();
      const result = gate("noop", [], homeEnv(lease.childEnv({})));
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Validation slot: ran inside the slot of the process that started this runner");
      expect(readHolderRecord().token).toBe(lease.token);
    });

    it("takes the slot in a token-less NDX_VALIDATION_SLOT_DIR, as hench hands it to a confined command", async () => {
      selectTinySuites();
      const handed = join(home, "handed-slot");
      held = await acquireValidationSlot({ slotDir: handed, projectDir: "/elsewhere", env: {} });
      const run = startGate("noop", { NDX_VALIDATION_SLOT_DIR: handed });
      await vi.waitFor(
        () => expect(run.output()).toContain(`(${join(handed, "holder.json")})`),
        { timeout: 30_000, interval: 50 },
      );
      await held.release();
      const result = await run.done;
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Validation slot: queued \d+\.\ds/);
      expect(existsSync(holderFile())).toBe(false);
    });

    // macOS reads the machine id with `ioreg`; a stand-in that fails puts a
    // failing lookup on PATH, as a sandbox that refuses IOKit would.
    describe.runIf(process.platform === "darwin")("under a failing machine-id lookup", () => {
      // fakebin/ comes first on the runner's PATH (gateEnv).
      beforeEach(() => {
        write("fakebin/ioreg", "#!/bin/sh\nexit 1\n", 0);
        chmodSync(join(root, "fakebin/ioreg"), 0o755);
      });

      it("runs unslotted with a warning when it has to look the directory up", () => {
        selectTinySuites();
        const result = gate("noop", [], homeEnv());
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("Validation slot: skipped (could not take it in ");
        expect(result.stdout).toContain("could not read this host's machine id");
      });

      it("nests on the holder its environment names without the lookup", async () => {
        selectTinySuites();
        const lease = await hold();
        const result = gate("noop", [], homeEnv(lease.childEnv({})));
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("Validation slot: ran inside the slot of the process that started this runner");
        expect(result.stderr).not.toContain("machine id");
      });
    });

    // A home it may not write stands in for a sandbox that does not grant the
    // slot. POSIX permission bits, and root ignores them.
    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "runs the suites without the slot, warning with the slot directory and the sandbox, when it may not use the slot",
      () => {
        selectTinySuites();
        chmodSync(home, 0o500);
        try {
          const result = gate("noop", [], homeEnv());
          expect(result.status, result.stderr).toBe(0);
          expect(result.stderr).toContain(`WARNING: Could not take the validation slot in ${slotDir}`);
          expect(result.stderr).toContain(`This process may not read or write ${slotDir}`);
          expect(result.stderr).toContain("sandbox must grant this directory read and write access");
          expect(result.stderr).toContain("WARNING: running the suites without the validation slot.");
          expect(result.stdout).toContain("2/2 suites passed");
          expect(result.stdout).toContain(`Validation slot: skipped (could not take it in ${slotDir}: `);
        } finally {
          chmodSync(home, 0o700);
        }
      },
    );

    it("runs without the slot under --no-slot, and --list never takes it", async () => {
      await hold();
      const unslotted = gate("noop", ["--no-slot"], homeEnv());
      expect(unslotted.status).toBe(0);
      expect(unslotted.stdout).toContain("Validation slot: not taken (--no-slot)");
      expect(gate("noop", ["--list"], homeEnv()).status).toBe(0);
      await held.release();

      rmSync(slotDir, { recursive: true, force: true });
      expect(gate("noop", ["--list"], homeEnv()).status).toBe(0);
      expect(existsSync(slotDir)).toBe(false);
    });

    // Windows has no catchable SIGTERM: kill() ends the runner outright.
    it.skipIf(process.platform === "win32")(
      "rebuilds only once it holds the slot, hands the suites its token, and gives it back on SIGTERM after the suite exits",
      async () => {
        editSource();
        await hold();
        const marker = join(root, "suite-started");
        const run = startGate("build", { FAKE_SUITE_MARKER: marker });
        await vi.waitFor(() => expect(run.output()).toContain("Waiting for the validation slot"), {
          timeout: 30_000,
          interval: 50,
        });
        expect(pnpmCalls()).toEqual([]);
        await held.release();

        await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 30_000, interval: 50 });
        await vi.waitFor(() => expect(readHolderRecord().child?.pid).toBeGreaterThan(0), {
          timeout: 30_000,
          interval: 50,
        });
        const record = readHolderRecord();
        expect(record.pid).toBe(run.child.pid);
        expect(JSON.parse(readFileSync(marker, "utf-8"))).toEqual({ token: record.token, dir: slotDir });
        expect(pnpmCalls().filter((a) => a.includes("build"))).toEqual([["--filter", "@n-dx/llm-client", "run", "build"]]);

        run.child.kill("SIGTERM");
        const result = await run.done;
        expect(result.code).toBe(143);
        expect(result.stderr).toContain("Stopped by SIGTERM");
        expect(existsSync(holderFile())).toBe(false);
        // The suite was stopped before the slot was given back.
        expect(() => process.kill(record.child.pid, 0)).toThrow();
      },
    );
  });
});
