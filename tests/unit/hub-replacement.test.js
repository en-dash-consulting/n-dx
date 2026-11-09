/**
 * `ndx start` replaces a hub that is not the one it would start.
 *
 * A hub that kept running across a rebuild or upgrade used to be named, with
 * advice to run `ndx hub stop` and `ndx start` by hand. `ndx start` now
 * replaces it, unless that would cut off an agent run or an MCP session, in
 * which case it defers, says when, and names the one flag that forces it.
 * These pin the decision and every word of it, without a hub.
 *
 * @see packages/core/hub-replacement.js
 * @see packages/core/web.js — ensureHub, replaceOrDeferHub, gatherHubLiveWork, restoreHubProjects
 * @see tests/e2e/cli-start-replace-hub.test.js — the same, through `ndx start` against a real older hub process
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPLACE_HUB_FLAG,
  changedHubNote,
  countLiveHenchLocks,
  deferredHubSignInFix,
  describeLiveWork,
  formatReplacementResult,
  hubAuthReason,
  hubReplacementNotice,
  keptTokenHubNote,
  liveWorkAnswer,
  planHubReplacement,
  spawnReplacementHub,
} from "../../packages/core/hub-replacement.js";

const reason = { kind: "build", text: "the running n-dx hub predates this ndx (it reports no build identity)" };
const idle = { runs: [{ project: "alpha", count: 0 }], mcpSessions: [{ project: "alpha", count: 0 }] };
const busy = {
  runs: [{ project: "alpha", count: 1 }, { project: "beta", count: 0 }],
  mcpSessions: [{ project: "alpha", count: 0 }, { project: "beta", count: 2 }, { project: "gamma", count: 1 }],
};

/** No message here may send the operator to stop or restart anything by hand. */
function expectNoManualRestart(text) {
  expect(text).not.toMatch(/ndx hub stop/);
  expect(text).not.toMatch(/pnpm/);
  expect(text).not.toMatch(/\brestart\b/i);
}

describe("describeLiveWork", () => {
  it("is null when nothing is running", () => {
    expect(describeLiveWork(idle)).toBeNull();
    expect(describeLiveWork({ runs: [], mcpSessions: [] })).toBeNull();
  });

  it("names the runs and sessions, and the projects they are in", () => {
    expect(describeLiveWork(busy)).toBe("1 agent run (alpha) and 3 open MCP sessions (beta, gamma)");
    expect(describeLiveWork({ runs: [{ project: "a", count: 2 }], mcpSessions: [] })).toBe("2 agent runs (a)");
    expect(describeLiveWork({ runs: [], mcpSessions: [{ project: "b", count: 1 }] })).toBe("1 open MCP session (b)");
  });

  it("names Sidecar turns in flight, in a project and in the hub's own Sidecar, so either defers", () => {
    const project = { runs: [], mcpSessions: [], sidecarTurns: [{ project: "beta", count: 1 }] };
    expect(describeLiveWork(project)).toBe("1 Sidecar turn in progress (beta)");
    expect(describeLiveWork({ runs: [], mcpSessions: [], hubSidecarTurns: 1 })).toBe("a turn in progress in the hub's Sidecar");
    expect(describeLiveWork({ ...busy, sidecarTurns: [{ project: "beta", count: 2 }], hubSidecarTurns: 1 }))
      .toBe("1 agent run (alpha), 3 open MCP sessions (beta, gamma), 2 Sidecar turns in progress (beta) and a turn in progress in the hub's Sidecar");
    expect(planHubReplacement({ reason, liveWork: { runs: [], mcpSessions: [], hubSidecarTurns: 1 }, force: false, port: 4100 }).action).toBe("defer");
  });
});

describe("planHubReplacement", () => {
  it("replaces a hub with nothing live on it", () => {
    expect(planHubReplacement({ reason, liveWork: idle, force: false, port: 4100 })).toEqual({ action: "replace", interrupts: null });
  });

  it("defers with live work, saying what is in the way, when it happens, and the one flag that forces it", () => {
    const plan = planHubReplacement({ reason, liveWork: busy, force: false, port: 4100 });
    expect(plan.action).toBe("defer");
    expect(plan.note).toContain("port 4100");
    expect(plan.note).toContain(reason.text);
    expect(plan.note).toContain("1 agent run (alpha) and 3 open MCP sessions (beta, gamma)");
    expect(plan.note).toContain("after that work ends");
    expect(plan.note).toContain(REPLACE_HUB_FLAG);
    expect(plan.note.split("--").length - 1).toBe(1);
    expectNoManualRestart(plan.note);
  });

  it("replaces anyway when forced, and says what that interrupts", () => {
    const plan = planHubReplacement({ reason, liveWork: busy, force: true, port: 4100 });
    expect(plan).toEqual({ action: "replace", interrupts: "1 agent run (alpha) and 3 open MCP sessions (beta, gamma)" });
    expect(hubReplacementNotice(reason, 4100, 3, plan.interrupts)).toContain(`as ${REPLACE_HUB_FLAG} asked`);
  });
});

describe("liveWorkAnswer", () => {
  it("reads a 200, counts a pre-route 404 or a project with no server as none, and anything else as unknown", () => {
    expect(liveWorkAnswer({ status: 200, body: { mcpSessions: {} } })).toBe("known");
    expect(liveWorkAnswer({ status: 404, body: { error: "Not found" } })).toBe("none");
    expect(liveWorkAnswer({ status: 503, body: { error: 'Project "alpha" has no running server', status: { state: "stopped" } } })).toBe("none");
    // Could not tell: a timeout or unreachable server, a 5xx, a 401, a 200 with no body.
    for (const res of [{ status: 0, body: null }, { status: 500, body: {} }, { status: 502, body: null }, { status: 503, body: { error: "busy" } }, { status: 401, body: { error: "Unauthorized" } }, { status: 200, body: null }]) {
      expect(liveWorkAnswer(res), JSON.stringify(res)).toBe("unknown");
    }
  });
});

describe("planHubReplacement with projects it could not check", () => {
  it("defers when a project's live work could not be read, and names it", () => {
    const plan = planHubReplacement({ reason, liveWork: { ...idle, unchecked: ["beta"] }, force: false, port: 4100 });
    expect(plan.action).toBe("defer");
    expect(plan.note).toContain("Whether it would interrupt work in project (beta) could not be checked, so it keeps running for now.");
    expect(plan.note).toContain("The next 'ndx start' checks again");
    expect(plan.note).toContain(REPLACE_HUB_FLAG);
    expectNoManualRestart(plan.note);
  });

  it("names both the live work and the projects it could not check", () => {
    const plan = planHubReplacement({ reason, liveWork: { ...busy, unchecked: ["delta", "eps"] }, force: false, port: 4100 });
    expect(plan.note).toContain("Replacing it now would interrupt 1 agent run (alpha) and 3 open MCP sessions (beta, gamma), and whether it would interrupt work in 2 projects (delta, eps) could not be checked");
    expect(plan.note).toContain("after that work ends");
  });

  it("replaces anyway when forced", () => {
    expect(planHubReplacement({ reason, liveWork: { ...idle, unchecked: ["beta"] }, force: true, port: 4100 })).toEqual({ action: "replace", interrupts: null });
  });
});

describe("hubReplacementNotice", () => {
  it("says the projects come back on the same URLs", () => {
    const text = hubReplacementNotice(reason, 4100, 25, null);
    expect(text).toBe(`Replacing the n-dx hub on port 4100: ${reason.text}. Its 25 projects come back on the same /p/<id>/ URLs.`);
    expect(hubReplacementNotice(reason, 4100, 1, null)).toContain("Its project comes back on the same /p/<id>/ URL.");
    expect(hubReplacementNotice(reason, 4100, 0, null)).toContain("It serves no projects yet.");
    expectNoManualRestart(text);
  });
});

describe("hubAuthReason", () => {
  it("replaces an open hub with a token hub for a command that wants the token", () => {
    const reason = hubAuthReason("open", "token", "/u/.ndx/auth.token");
    expect(reason).toMatchObject({ kind: "auth", wanted: "token" });
    expect(reason.text).toContain("runs without authentication");
    expect(hubReplacementNotice(reason, 4100, 2, null)).not.toContain("without the token");
  });

  it("replaces a token hub with an open one only because the command asked, and says so", () => {
    const reason = hubAuthReason("token", "open", null);
    expect(reason).toMatchObject({ kind: "auth", wanted: "open" });
    expect(reason.text).toContain("asked for no authentication");
    const notice = hubReplacementNotice(reason, 4100, 2, null);
    expect(notice).toContain(`Because this command asked for no authentication (--no-auth, or web.auth=false) and passed ${REPLACE_HUB_FLAG}`);
    expect(notice).toContain("serves every project on it without the token");
    expectNoManualRestart(notice);
  });

  it("names the token file a hub with another token does not hold", () => {
    expect(hubAuthReason("mismatch", "token", "/u/.ndx/auth.token").text).toContain("/u/.ndx/auth.token");
  });

  it("defers like a stale hub when work is live on it", () => {
    const plan = planHubReplacement({ reason: hubAuthReason("open", "token", null), liveWork: busy, force: false, port: 4100 });
    expect(plan.action).toBe("defer");
    expect(plan.note).toContain(REPLACE_HUB_FLAG);
    expectNoManualRestart(plan.note);
  });
});

describe("formatReplacementResult", () => {
  it("lists the projects serving again and any still coming up, without manual advice", () => {
    const lines = formatReplacementResult({
      healthy: ["alpha", "beta"],
      unhealthy: [{ id: "gamma", state: "starting", lastError: null }, { id: "delta", state: "unreachable", lastError: "ECONNREFUSED" }],
    }, 4100);
    expect(lines).toEqual([
      "  Serving again on port 4100: alpha, beta.",
      "  gamma is registered but its server is starting; the hub keeps retrying it.",
      "  delta is registered but its server is unreachable: ECONNREFUSED; the hub keeps retrying it.",
    ]);
    for (const line of lines) expectNoManualRestart(line);
  });
});

describe("deferredHubSignInFix", () => {
  it("says when the older hub goes, and the flag, not a stop command", () => {
    expect(deferredHubSignInFix()).toContain(REPLACE_HUB_FLAG);
    expectNoManualRestart(deferredHubSignInFix());
  });
});

describe("countLiveHenchLocks", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ndx-hub-locks-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("counts the locks whose process is alive, and ignores dead, corrupt and foreign files", () => {
    mkdirSync(join(dir, "locks"));
    writeFileSync(join(dir, "locks", "101.lock"), JSON.stringify({ pid: 101, startedAt: "x", taskId: "t1" }));
    writeFileSync(join(dir, "locks", "102.lock"), JSON.stringify({ pid: 102, startedAt: "x" }));
    writeFileSync(join(dir, "locks", "103.lock"), "{not json");
    writeFileSync(join(dir, "locks", "notes.txt"), JSON.stringify({ pid: 101 }));
    expect(countLiveHenchLocks(dir, { isAlive: (pid) => pid === 101 })).toBe(1);
    expect(countLiveHenchLocks(dir, { isAlive: () => true })).toBe(2);
  });

  it("is zero with no locks directory", () => {
    expect(countLiveHenchLocks(join(dir, "nowhere"))).toBe(0);
  });
});

describe("keptTokenHubNote", () => {
  it("says the project is served with the token, and that opening the hub for everyone takes --replace-hub", () => {
    const note = keptTokenHubNote(4100);
    expect(note).toContain("port 4100");
    expect(note).toContain("served with it like every other project on that hub");
    expect(note).toContain(REPLACE_HUB_FLAG);
    expectNoManualRestart(note);
  });
});

describe("changedHubNote", () => {
  it("joins the hub another ndx start put there, without advice to stop anything", () => {
    const note = changedHubNote(4100);
    expect(note).toContain("port 4100");
    expect(note).toContain("joins that hub");
    expectNoManualRestart(note);
  });
});

describe("spawnReplacementHub", () => {
  it("tries a failed start once more", async () => {
    let calls = 0;
    const spawned = await spawnReplacementHub(async () => {
      calls++;
      if (calls === 1) throw new Error("n-dx hub did not start on port 4100 within 15000ms");
      return { spawned: true, pid: 7 };
    }, { port: 4100, projects: 2 });
    expect(spawned).toEqual({ spawned: true, pid: 7 });
    expect(calls).toBe(2);
  });

  it("after a second failure, says nothing serves the port and the next ndx start brings every project back", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("n-dx hub did not start on port 4100 within 15000ms");
    };
    const error = await spawnReplacementHub(failing, { port: 4100, projects: 3 }).catch((e) => e);
    expect(calls).toBe(2);
    expect(error.message).toContain("n-dx hub did not start on port 4100");
    expect(error.message).toContain("nothing serves that port now");
    expect(error.message).toContain("hub.json still lists all 3 of its projects, and the next 'ndx start' brings every one back on its own /p/<id>/ URL.");
    expectNoManualRestart(error.message);
  });
});
