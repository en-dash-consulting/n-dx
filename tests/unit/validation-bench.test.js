/**
 * scripts/bench/validation-bench.mjs — the pure parts: host-reading parsers,
 * the process checks, the runner-output parser, the summary arithmetic and
 * the plan `--dry-run` prints. Nothing here spawns a benchmark.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ancestorPids,
  findBusyProcesses,
  parseProcMeminfo,
  parseProcVmstat,
  parsePs,
  parseSwapUsage,
  parseVmStat,
  treeRssBytes,
} from "../../scripts/bench/lib/samples.mjs";
import { createLineCollector, parseGateOutput } from "../../scripts/bench/lib/gate-output.mjs";
import { counterRise, median, renderSummaryMarkdown, summarize } from "../../scripts/bench/lib/summary.mjs";
import { runBatch } from "../../scripts/bench/lib/batch.mjs";
import {
  BenchUsageError,
  CASES,
  DEFAULT_FIXTURES,
  IDLE_WARNING,
  USAGE,
  FIXTURES,
  buildPlan,
  caseEnv,
  estimateBatchSeconds,
  formatPlan,
  parseBenchArgs,
  runnerArgs,
  slotModuleMissingMessage,
} from "../../scripts/bench/lib/plan.mjs";
import { readWorkspaceManifests } from "../../scripts/lib/workspace-manifests.mjs";
import { settleAll } from "../../scripts/bench/lib/settle.mjs";

const ROOT = join(import.meta.dirname, "../..");
const REPO = "/work/n-dx";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3000.
Pages active:                            400000.
Pages inactive:                          390000.
Pages speculative:                         1000.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                           5000.
"Translation faults":                 900000000.
Pages copy-on-write:                   20000000.
Pageins:                               30000000.
Pageouts:                                 12345.
Swapins:                                 600000.
Swapouts:                                700000.
`;

const MEMINFO = `MemTotal:       16314420 kB
MemFree:          812344 kB
MemAvailable:    6123456 kB
Buffers:          123456 kB
SwapTotal:       2097148 kB
SwapFree:        1048574 kB
`;

describe("host-reading parsers", () => {
  it("reads free bytes and page-outs from vm_stat", () => {
    expect(parseVmStat(VM_STAT)).toEqual({ pageSize: 16384, freeBytes: 4000 * 16384, pageouts: 12345 });
  });

  it("returns nulls from vm_stat text it cannot read", () => {
    expect(parseVmStat("garbage")).toEqual({ pageSize: null, freeBytes: null, pageouts: null });
  });

  it("reads swap in use from sysctl vm.swapusage in M and G", () => {
    expect(parseSwapUsage("vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)")).toBe(Math.round(1024.5 * 1024 ** 2));
    expect(parseSwapUsage("vm.swapusage: total = 4.00G  used = 1.25G  free = 2.75G  (encrypted)")).toBe(1.25 * 1024 ** 3);
    expect(parseSwapUsage("vm.swapusage: unavailable")).toBeNull();
  });

  it("reads available memory and swap in use from /proc/meminfo", () => {
    expect(parseProcMeminfo(MEMINFO)).toEqual({ freeBytes: 6123456 * 1024, swapUsedBytes: (2097148 - 1048574) * 1024 });
  });

  it("falls back to MemFree without MemAvailable and leaves swap null without swap lines", () => {
    expect(parseProcMeminfo("MemFree:  100 kB\n")).toEqual({ freeBytes: 102400, swapUsedBytes: null });
  });

  it("reads pswpout from /proc/vmstat", () => {
    expect(parseProcVmstat("pswpin 10\npswpout 4242\npgfault 9\n")).toBe(4242);
    expect(parseProcVmstat("pswpin 10\n")).toBeNull();
  });
});

describe("process table", () => {
  const PS = `    1     0  1000 /sbin/launchd
  100     1  2000 -zsh
  200   100  3000 node scripts/bench/validation-bench.mjs --out /tmp/b
  300   200  4000 node scripts/run-all-tests.mjs affected abc
  301   300  5000 node /x/node_modules/.bin/vitest run
  302   301  6000 node /x/vitest/dist/workers/forks.js
  400     1  7000 node /usr/local/bin/ndx work --auto .
  500     1  8000 node /x/packages/hench/dist/cli/index.js run --task=1 .
  600     1   900 node /x/packages/hench/dist/cli/index.js status .
`;
  const rows = parsePs(PS);

  it("parses pid, ppid, rss and the command", () => {
    expect(rows[2]).toEqual({ pid: 200, ppid: 100, rssKb: 3000, command: "node scripts/bench/validation-bench.mjs --out /tmp/b" });
    expect(rows).toHaveLength(9);
  });

  it("sums RSS over a process tree", () => {
    expect(treeRssBytes(rows, [300])).toBe((4000 + 5000 + 6000) * 1024);
    expect(treeRssBytes(rows, [999])).toBe(0);
  });

  it("finds hench runs, the runner, vitest and ndx work, but not this process's ancestors or hench status", () => {
    const busy = findBusyProcesses(rows, ancestorPids(rows, 200));
    expect(busy.map((b) => [b.pid, b.reason])).toEqual([
      [300, "run-all-tests"],
      [301, "vitest"],
      [302, "vitest"],
      [400, "ndx work"],
      [500, "hench run"],
    ]);
  });

  it("walks ancestors up to the root", () => {
    expect(ancestorPids(rows, 302)).toEqual([302, 301, 300, 200, 100, 1]);
  });
});

describe("runner output", () => {
  const OUTPUT = [
    [0, "test-gate: selected-suites=root-policy,hench"],
    [0, "test-gate: reason hench: changed packages/hench/src/x.ts"],
    [1000, ""],
    [1000, "──────── root policy (static) ────────"],
    [1500, " ✓ tests/e2e/architecture-policy.test.js"],
    [4000, "──────── @n-dx/hench ────────"],
    [9000, "Error: Test timed out in 5000ms."],
    [64000, "──────── summary ────────"],
    [64000, "  PASS  root policy (static)"],
    [64000, "  FAIL  @n-dx/hench          → .test-logs/n-dx-hench.log"],
    [64000, "test-gate: failed-suites=hench"],
  ];

  it("reads selection, per-suite results and durations, and vitest timeouts", () => {
    const parsed = parseGateOutput(OUTPUT.map(([t, line]) => ({ t, line })));
    expect(parsed).toEqual({
      selectedSuites: ["root-policy", "hench"],
      failedSuites: ["hench"],
      staleDist: null,
      testTimeouts: 1,
      suites: [
        { label: "root policy (static)", ok: true, durationMs: 3000 },
        { label: "@n-dx/hench", ok: false, durationMs: 60000 },
      ],
    });
  });

  it("leaves a suite cut off before the summary with unknown result and duration", () => {
    const parsed = parseGateOutput([{ t: 0, line: "──────── @n-dx/web ────────" }]);
    expect(parsed.suites).toEqual([{ label: "@n-dx/web", ok: null, durationMs: null }]);
  });

  it("splits streamed chunks into lines stamped with their arrival", () => {
    const c = createLineCollector();
    c.push("a\nb", 1);
    c.push("c\r\nd", 2);
    c.flush(3);
    expect(c.lines).toEqual([{ t: 1, line: "a" }, { t: 2, line: "bc" }, { t: 3, line: "d" }]);
  });
});

describe("summary arithmetic", () => {
  it("takes the median of odd and even counts and ignores non-numbers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5])).toBe(5);
    expect(median([])).toBeNull();
  });

  it("measures a counter's rise across samples", () => {
    expect(counterRise([{ p: 10 }, { p: null }, { p: 25 }], "p")).toBe(15);
    expect(counterRise([{ p: null }], "p")).toBeNull();
  });

  const batches = [
    { batchId: "1", caseId: "C", fixture: "web", repeat: 1, startMs: 0, endMs: 600_000 },
    { batchId: "2", caseId: "D", fixture: "web", repeat: 1, startMs: 700_000, endMs: 1_600_000 },
    { batchId: "3", caseId: "D", fixture: "web", repeat: 2, startMs: 1_700_000, endMs: 2_500_000 },
  ];
  const runs = [
    // A C record as the first real run wrote it: queue figures from a slot the case never asked for.
    { batchId: "1", wallMs: 500_000, exitCode: 1, timedOut: false, testTimeouts: 2, slotTaken: false, queueMs: 125_000, execMs: 375_000 },
    { batchId: "1", wallMs: 600_000, exitCode: 0, timedOut: false, testTimeouts: 0, slotTaken: false, queueMs: null, execMs: null },
    { batchId: "2", wallMs: 300_000, exitCode: 0, timedOut: false, testTimeouts: 0, slotTaken: true, queueMs: 0, execMs: 300_000 },
    { batchId: "2", wallMs: 900_000, exitCode: 0, timedOut: false, testTimeouts: 0, slotTaken: true, queueMs: 600_000, execMs: 300_000 },
    { batchId: "3", wallMs: 800_000, exitCode: null, timedOut: true, testTimeouts: 0, slotTaken: true, queueMs: 400_000, execMs: 400_000 },
  ];
  const samples = [
    { batchId: "1", rssBytes: 9e9, swapUsedBytes: 2e9, freeBytes: 1e8, load1: 20, pageouts: 100 },
    { batchId: "1", rssBytes: 7e9, swapUsedBytes: 3e9, freeBytes: 2e8, load1: 30, pageouts: 900 },
    { batchId: "2", rssBytes: 3e9, swapUsedBytes: 1e9, freeBytes: 4e9, load1: 6, pageouts: 1000 },
    { batchId: "2", rssBytes: 4e9, swapUsedBytes: 1e9, freeBytes: 3e9, load1: 7, pageouts: 1010 },
    { batchId: "3", rssBytes: 2e9, swapUsedBytes: null, freeBytes: 5e9, load1: 5, pageouts: 1020 },
    { batchId: "3", rssBytes: 2e9, swapUsedBytes: null, freeBytes: 5e9, load1: 5, pageouts: 1025 },
  ];

  it("builds one row per fixture and case from runs, batches and samples", () => {
    const rows = summarize({ runs, batches, samples });
    expect(rows).toEqual([
      {
        caseId: "C", fixture: "web", runs: 2, medianWallMs: 550_000, totalBatchMs: 600_000,
        peakRssBytes: 9e9, peakSwapBytes: 3e9, minFreeBytes: 1e8, peakLoad: 30, pageouts: 800,
        failures: 1, timeouts: 0, testTimeouts: 2, medianQueueMs: null, medianExecMs: null,
      },
      {
        caseId: "D", fixture: "web", runs: 3, medianWallMs: 800_000, totalBatchMs: 1_700_000,
        peakRssBytes: 4e9, peakSwapBytes: 1e9, minFreeBytes: 3e9, peakLoad: 7, pageouts: 15,
        failures: 1, timeouts: 1, testTimeouts: 0, medianQueueMs: 400_000, medianExecMs: 300_000,
      },
    ]);
  });

  it("renders the rows as a Markdown table with the commit and machine", () => {
    const md = renderSummaryMarkdown(summarize({ runs, batches, samples }), {
      commit: "abc123", machine: "10 cores", startedAt: "s", finishedAt: "f",
      cases: ["C", "D"], fixtures: ["web"], repeat: 2, concurrency: 3,
    });
    expect(md).toContain("- Commit: `abc123`");
    expect(md).toContain("| web | C | 2 | 9.2 min | 10.0 min | 8.38 GiB | 2.79 GiB | 0.09 GiB | 800 | 30.0 | 1 | 0/2 | – | – |");
    expect(md).toContain("| web | D | 3 | 13.3 min | 28.3 min | 3.73 GiB | 0.93 GiB | 2.79 GiB | 15 | 7.0 | 1 | 1/0 | 400 s | 300 s |");
  });
});

describe("batch settling", () => {
  it("holds a rejection until every run has settled, then rethrows the first", async () => {
    let finishRunning;
    const running = new Promise((resolvePromise) => { finishRunning = resolvePromise; });
    const aborted = Promise.reject(new Error("aborted while waiting for the slot"));
    let outcome = "pending";
    const settled = settleAll([running, aborted]).then(
      () => { outcome = "resolved"; },
      (err) => { outcome = err.message; },
    );
    // Drain microtasks: Promise.all would have rejected by now.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(outcome).toBe("pending");
    finishRunning("done");
    await settled;
    expect(outcome).toBe("aborted while waiting for the slot");
  });

  it("returns every value in order when all resolve", async () => {
    await expect(settleAll([Promise.resolve(1), Promise.resolve(2)])).resolves.toEqual([1, 2]);
  });
});

describe("batch slot use", () => {
  // A manual clock: a run advances it by RUN_MS when it finishes, so start
  // times are exact and a run that waited behind another starts RUN_MS later.
  const RUN_MS = 100;

  /** A host slot that admits one holder at a time and counts every call. */
  function fakeSlotApi(now) {
    const calls = { acquire: 0, release: 0 };
    let tail = Promise.resolve();
    return {
      calls,
      slotDir: "/fake/slot",
      async acquireValidationSlot() {
        calls.acquire++;
        const asked = now();
        let free;
        const previous = tail;
        tail = new Promise((r) => { free = r; });
        await previous;
        return {
          nested: false,
          queueWaitMs: now() - asked,
          childEnv: (e) => ({ ...e, NDX_VALIDATION_SLOT: "fake-token" }),
          recordChild: async () => {},
          release: async () => { calls.release++; free(); },
        };
      },
    };
  }

  async function run(caseId, { withSlot = true } = {}) {
    let t = 0;
    const now = () => t;
    const slotApi = withSlot ? fakeSlotApi(now) : null;
    const launched = [];
    const records = await runBatch({
      batch: { caseId, fixture: "hench", repeat: 1, batchId: `1-${caseId}`, worktrees: CASES[caseId].concurrent ? 3 : 1 },
      worktrees: ["/wt/1", "/wt/2", "/wt/3"],
      slotApi,
      baseEnv: { PATH: "/bin" },
      now,
      launch: async ({ worker, env, lease }) => {
        launched.push({ worker, env, lease, args: runnerArgs(caseId, "abc") });
        await new Promise((r) => setImmediate(r));
        t += RUN_MS;
        return { exitCode: 0 };
      },
    });
    return { records, launched, calls: slotApi?.calls };
  }

  it("never acquires in A, B, C or F, which still pass --no-slot", async () => {
    for (const caseId of ["A", "B", "C", "F"]) {
      const { records, launched, calls } = await run(caseId);
      expect(calls).toEqual({ acquire: 0, release: 0 });
      expect(launched.every((l) => l.lease === null && l.args.includes("--no-slot") && !("NDX_VALIDATION_SLOT" in l.env))).toBe(true);
      expect(records.every((r) => r.slot === false && r.slotTaken === false && r.queueMs === null && r.execMs === null)).toBe(true);
    }
  });

  it("starts the runs of C and F, the parallel cases without the slot, together", async () => {
    for (const caseId of ["C", "F"]) {
      const { records } = await run(caseId);
      expect(records.map((r) => r.startedAt)).toEqual([0, 0, 0]);
    }
  });

  it("acquires and releases once per run in D and E, nesting the runner and running one at a time", async () => {
    for (const caseId of ["D", "E"]) {
      const { records, launched, calls } = await run(caseId);
      expect(calls).toEqual({ acquire: 3, release: 3 });
      expect(launched.every((l) => l.lease !== null && !l.args.includes("--no-slot") && l.env.NDX_VALIDATION_SLOT === "fake-token")).toBe(true);
      expect(records.every((r) => r.slot === true && r.slotTaken === true && r.slotNested === false)).toBe(true);
      // The slot serialises the batch: each run queues behind the ones before it.
      expect(records.map((r) => [r.startedAt, r.queueMs, r.execMs])).toEqual([[0, 0, RUN_MS], [RUN_MS, RUN_MS, RUN_MS], [2 * RUN_MS, 2 * RUN_MS, RUN_MS]]);
    }
  });

  it("acquires once in the solo slot cases G and H and records a zero queue", async () => {
    for (const caseId of ["G", "H"]) {
      const { records, launched, calls } = await run(caseId);
      expect(calls).toEqual({ acquire: 1, release: 1 });
      expect(launched).toHaveLength(1);
      expect(launched[0].args).not.toContain("--no-slot");
      expect(launched[0].env.NDX_VALIDATION_SLOT).toBe("fake-token");
      expect(records.map((r) => [r.slotTaken, r.queueMs, r.execMs])).toEqual([[true, 0, RUN_MS]]);
    }
  });

  it("refuses to run any slot case without a slot module", async () => {
    for (const caseId of ["D", "E", "G", "H"]) {
      await expect(run(caseId, { withSlot: false })).rejects.toThrow(`Case ${caseId} takes the host slot`);
    }
  });

  it("names the selected slot cases, not case D, when hench's slot module is missing", () => {
    expect(slotModuleMissingMessage(["G"], "/m.js")).toBe("Case G takes the host slot, which needs hench's built slot module (/m.js). Run: pnpm --filter @n-dx/hench build");
    expect(slotModuleMissingMessage(["D", "E", "H"], "/m.js")).toMatch(/^Cases D, E, H take the host slot/);
  });
});

describe("plan and flags", () => {
  const parse = (argv) => parseBenchArgs(argv, { repoRoots: [REPO], cwd: "/home/u" });

  it("defaults to the baseline cases A–D, the first three fixtures, one repeat and three worktrees", () => {
    expect(parse(["--out", "/tmp/b"])).toMatchObject({
      out: "/tmp/b", cases: ["A", "B", "C", "D"], fixtures: DEFAULT_FIXTURES, repeat: 1, concurrency: 3, dryRun: false, keep: false,
    });
  });

  it("accepts the pairings E–H with --cases and lists all eight in the usage text", () => {
    expect(parse(["--out", "/tmp/b", "--cases", "e,F,G,H"]).cases).toEqual(["E", "F", "G", "H"]);
    expect(Object.keys(CASES)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(USAGE).toContain("any of A–H (default A,B,C,D)");
    for (const id of Object.keys(CASES)) expect(USAGE).toMatch(new RegExp(`^ +${id} (1 worktree|N worktrees at once)`, "m"));
  });

  it("gives E–H the cap and slot their labels name", () => {
    expect(Object.values(CASES).map(({ id, concurrent, maxWorkers, slot }) => [id, concurrent, maxWorkers, slot])).toEqual([
      ["A", false, null, false],
      ["B", false, "2", false],
      ["C", true, null, false],
      ["D", true, "2", true],
      ["E", true, null, true],
      ["F", true, "2", false],
      ["G", false, null, true],
      ["H", false, "2", true],
    ]);
  });

  it("estimates G/H as A/B, E as the runs back to back, and F as C slowed by the cap", () => {
    const est = (id) => estimateBatchSeconds(id, 100, 3);
    expect(est("G")).toBe(est("A"));
    expect(est("H")).toBe(est("B"));
    expect(est("E")).toBe(3 * est("A"));
    expect(est("F") / est("C")).toBeCloseTo(est("B") / est("A"));
  });

  it("requires --out outside the repository and rejects unknown cases, fixtures and counts", () => {
    expect(() => parse([])).toThrow(/--out <dir> is required/);
    expect(() => parse(["--out", `${REPO}/bench`])).toThrow(/outside the repository/);
    expect(() => parse(["--out", "/tmp/b", "--cases", "A,Z"])).toThrow(/unknown "Z"/);
    expect(() => parse(["--out", "/tmp/b", "--fixtures", "nope"])).toThrow(BenchUsageError);
    expect(() => parse(["--out", "/tmp/b", "--repeat", "0"])).toThrow(/positive integer/);
  });

  it("gives each case its worker cap and slot, and never an inherited slot token", () => {
    const base = { PATH: "/bin", NDX_TEST_MAX_WORKERS: "7", NDX_VALIDATION_SLOT: "stale" };
    expect(caseEnv("A", base)).toEqual({ PATH: "/bin" });
    expect(caseEnv("D", base)).toEqual({ PATH: "/bin", NDX_TEST_MAX_WORKERS: "2" });
    expect(runnerArgs("C", "abc")).toEqual(["scripts/run-all-tests.mjs", "affected", "abc", "--no-slot"]);
    // D's runner finds the bench's token and runs nested rather than acquiring again.
    expect(runnerArgs("D", "abc")).toEqual(["scripts/run-all-tests.mjs", "affected", "abc"]);
    expect(caseEnv("E", base)).toEqual({ PATH: "/bin" });
    expect(caseEnv("F", base)).toEqual({ PATH: "/bin", NDX_TEST_MAX_WORKERS: "2" });
    expect(caseEnv("G", base)).toEqual({ PATH: "/bin" });
    expect(caseEnv("H", base)).toEqual({ PATH: "/bin", NDX_TEST_MAX_WORKERS: "2" });
    for (const id of ["E", "G", "H"]) expect(runnerArgs(id, "abc")).toEqual(["scripts/run-all-tests.mjs", "affected", "abc"]);
    expect(runnerArgs("F", "abc")).toEqual(["scripts/run-all-tests.mjs", "affected", "abc", "--no-slot"]);
  });

  it("prints E–H in the dry run with each case's slot line", () => {
    const options = parse(["--out", "/tmp/b", "--dry-run", "--cases", "E,F,G,H", "--fixtures", "docs"]);
    const text = formatPlan(buildPlan(options, { manifests: readWorkspaceManifests(ROOT), fileExists: () => true }), options);
    expect(text).toMatch(/E {2}3 worktrees {2}NDX_TEST_MAX_WORKERS unset +takes the host slot around each run +\(parallel, uncapped, host slot\)/);
    expect(text).toMatch(/F {2}3 worktrees {2}NDX_TEST_MAX_WORKERS=2 +never takes the host slot \(--no-slot\) +\(parallel, capped, no slot\)/);
    expect(text).toMatch(/G {2}1 worktree {3}NDX_TEST_MAX_WORKERS unset +takes the host slot around each run +\(solo, uncapped, host slot\)/);
    expect(text).toMatch(/H {2}1 worktree {3}NDX_TEST_MAX_WORKERS=2 +takes the host slot around each run +\(solo, capped, host slot\)/);
  });

  it("plans the matrix with each fixture's files, selected suites and an estimate", () => {
    const options = parse(["--out", "/tmp/b", "--dry-run", "--repeat", "2"]);
    const plan = buildPlan(options, { manifests: readWorkspaceManifests(ROOT), fileExists: () => true });
    expect(plan.fixtures.map((f) => f.name)).toEqual(DEFAULT_FIXTURES);
    expect(plan.fixtures[0].files).toEqual(FIXTURES.hench.files);
    expect(plan.fixtures[0].suites).toContain("hench");
    expect(plan.fixtures[1].suites).toEqual(expect.arrayContaining(["llm-client", "hench", "rex", "web"]));
    expect(plan.batches).toHaveLength(2 * 3 * 4);
    expect(plan.batches.filter((b) => b.caseId === "C").every((b) => b.worktrees === 3)).toBe(true);
    expect(plan.worktrees).toBe(3);
    expect(plan.estimate.totalSeconds).toBe(plan.estimate.setupSeconds + plan.estimate.runSeconds);

    const text = formatPlan(plan, options);
    expect(text).toContain(`touches  ${FIXTURES.web.files[0]}`);
    expect(text).toMatch(/A {2}1 worktree {3}NDX_TEST_MAX_WORKERS unset +never takes the host slot \(--no-slot\)/);
    expect(text).toMatch(/C {2}3 worktrees {2}NDX_TEST_MAX_WORKERS unset +never takes the host slot \(--no-slot\)/);
    expect(text).toMatch(/D {2}3 worktrees {2}NDX_TEST_MAX_WORKERS=2 +takes the host slot around each run/);
    expect(text).toMatch(/Estimate \(rough\): setup ~\d+ min, runs ~\d+ min, total ~\d+ min/);
    expect(text).toContain("Dry run: nothing was created.");
  });

  it("tells the operator in the usage text to keep the machine idle for the whole run", () => {
    expect(USAGE).toContain(IDLE_WARNING);
    expect(IDLE_WARNING).toMatch(/idle for the whole run/);
    expect(IDLE_WARNING).toMatch(/does not stop/);
  });

  it("plans the docs fixture as an empty selection and needs one worktree for solo cases", () => {
    const options = parse(["--out", "/tmp/b", "--cases", "A,B", "--fixtures", "docs"]);
    const plan = buildPlan(options, { manifests: readWorkspaceManifests(ROOT), fileExists: () => true });
    expect(plan.fixtures[0].suites).toEqual([]);
    expect(plan.worktrees).toBe(1);
  });

  it("fails clearly when a fixture file does not exist", () => {
    const options = parse(["--out", "/tmp/b", "--fixtures", "web"]);
    expect(() => buildPlan(options, { manifests: [], fileExists: () => false }))
      .toThrow(`Fixture "web" names a file that does not exist: ${FIXTURES.web.files[0]}`);
  });

  it("names fixture files that exist in this repository", () => {
    const options = parse(["--out", "/tmp/b", "--fixtures", Object.keys(FIXTURES).join(",")]);
    expect(() => buildPlan(options, { manifests: readWorkspaceManifests(ROOT), fileExists: (rel) => existsSync(join(ROOT, rel)) })).not.toThrow();
  });
});
