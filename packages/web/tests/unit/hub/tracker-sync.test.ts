/**
 * The hub's tracker sync clock: which projects are ticked when. Only a
 * project with a rule not off, only while its server is healthy, at once
 * when it becomes healthy, then every interval; one tick per project at a time.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChildState, ProjectView } from "../../../src/hub/index.js";
import { hasActiveTrackerRule, TrackerSyncClock, type TrackerTickOutcome } from "../../../src/hub/index.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

const INTERVAL = 300_000;

function project(id: string, state: ChildState = "healthy"): ProjectView {
  return {
    id, name: id, repoRoot: `/repos/${id}`, worktrees: [`/repos/${id}`], port: 1, pid: 1, lastSeen: null, ndxBin: "",
    status: { state, pid: 1, port: 1, attached: false, respawns: 0, lastHealthAt: null, lastError: null },
  };
}

function clockFor(projects: ProjectView[], wanted: Set<string>) {
  let now = 1_000_000;
  const posted: string[] = [];
  const logs: string[] = [];
  let answer: TrackerTickOutcome = { status: 200 };
  const clock = new TrackerSyncClock({
    projects: () => projects,
    wants: (p) => wanted.has(p.id),
    post: async (id) => {
      posted.push(id);
      return answer;
    },
    intervalMs: INTERVAL,
    now: () => now,
    log: (m) => logs.push(m),
  });
  return {
    clock, posted, logs,
    advance: (ms: number) => { now += ms; },
    answer: (a: TrackerTickOutcome) => { answer = a; },
  };
}

describe("TrackerSyncClock", () => {
  it("ticks only projects with a rule on, once on start and then each interval", async () => {
    const t = clockFor([project("alpha"), project("beta")], new Set(["alpha"]));
    await t.clock.sweep();
    expect(t.posted).toEqual(["alpha"]);
    t.advance(INTERVAL - 1);
    await t.clock.sweep();
    expect(t.posted).toEqual(["alpha"]);
    t.advance(1);
    await t.clock.sweep();
    expect(t.posted).toEqual(["alpha", "alpha"]);
  });

  it("skips a server that is not healthy, and ticks it as soon as it is", async () => {
    const projects = [project("alpha", "unreachable")];
    const t = clockFor(projects, new Set(["alpha"]));
    await t.clock.sweep();
    projects[0] = project("alpha", "starting");
    await t.clock.sweep();
    expect(t.posted).toEqual([]);
    projects[0] = project("alpha", "healthy");
    await t.clock.sweep();
    expect(t.posted).toEqual(["alpha"]);

    // Down and back up again inside the interval: a restarted server is ticked on start.
    t.advance(1_000);
    projects[0] = project("alpha", "unreachable");
    await t.clock.sweep();
    projects[0] = project("alpha", "healthy");
    await t.clock.sweep();
    expect(t.posted).toEqual(["alpha", "alpha"]);
  });

  it("does not overlap a project's ticks, and counts the interval from the attempt", async () => {
    let release!: () => void;
    const posted: string[] = [];
    const logs: string[] = [];
    let now = 0;
    const clock = new TrackerSyncClock({
      projects: () => [project("alpha")],
      wants: () => true,
      post: (id) => {
        posted.push(id);
        return new Promise((resolve) => { release = () => resolve({ error: "connect ECONNREFUSED" }); });
      },
      intervalMs: INTERVAL,
      now: () => now,
      log: (m) => logs.push(m),
    });
    const first = clock.sweep();
    now += INTERVAL;
    await clock.sweep();
    expect(posted).toEqual(["alpha"]);
    release();
    await first;
    expect(logs).toEqual(["[hub] alpha: tracker sync tick failed — connect ECONNREFUSED"]);
    // An interval has passed since the failed attempt started, not since it answered.
    expect(clock.due()).toEqual(["alpha"]);
  });

  it("logs a tick the project server refused", async () => {
    const t = clockFor([project("alpha")], new Set(["alpha"]));
    t.answer({ status: 403 });
    await t.clock.sweep();
    expect(t.logs).toEqual(["[hub] alpha: tracker sync tick answered HTTP 403"]);
  });
});

describe("hasActiveTrackerRule", () => {
  let dir: string;
  afterEach(async () => {
    await removeTestDir(dir);
  });

  it("is true only when the local config sets a rule to dry-run or on", () => {
    dir = mkdtempSync(join(tmpdir(), "hub-tracker-rule-"));
    const local = join(dir, ".n-dx.local.json");
    expect(hasActiveTrackerRule(dir)).toBe(false);
    writeFileSync(local, "{ not json");
    expect(hasActiveTrackerRule(dir)).toBe(false);
    writeFileSync(local, JSON.stringify({ trackerSync: { connection: "caos", rules: { "pr-merged": "off" } } }));
    expect(hasActiveTrackerRule(dir)).toBe(false);
    writeFileSync(local, JSON.stringify({ trackerSync: { connection: "caos", rules: { "pr-merged": "off", "run-started": "dry-run" } } }));
    expect(hasActiveTrackerRule(dir)).toBe(true);
    writeFileSync(local, JSON.stringify({ trackerSync: { rules: { "pr-merged": "on" } } }));
    expect(hasActiveTrackerRule(dir)).toBe(true);
  });
});
