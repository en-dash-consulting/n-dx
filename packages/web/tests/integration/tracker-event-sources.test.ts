/**
 * The ndx events tracker sync collects at each tick (story 45): a run start,
 * a PR opened with an N-DX-Item trailer, that PR merged, a release published
 * and a task's second failed run in a row, each queued once and never again
 * after a restart. A real v2 store on a temp tree, run records on disk, and a
 * fake gh/git; nothing reaches GitHub or a tracker.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveStore } from "@n-dx/rex";
import type { ExecResult } from "@n-dx/llm-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateInTree, type PRDItem } from "../../src/server/rex-gateway.js";
import { trackerCursorsPath } from "../../src/server/tracker/event-cursors.js";
import { collectTrackerEvents, COLLECTED_EVENTS, itemTrailerIds, tagVersions, type TrackerEventExec } from "../../src/server/tracker/event-sources.js";
import { changeItemLink } from "../../src/server/tracker/item-links.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

const V2_FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

let root: string;
let rexDir: string;
let runsDir: string;
let prs: Record<string, unknown>[];
let tags: string[];
let calls: string[];

const ok = (stdout: string): ExecResult => ({ launched: true, exitCode: 0, stdout, stderr: "", error: null }) as ExecResult;

/** gh answers `prs`, git answers `tags`; anything else is a test error. */
const fakeExec: TrackerEventExec = async (cmd, args) => {
  calls.push(`${cmd} ${args[0]}`);
  if (cmd === "gh" && args[0] === "pr") return ok(JSON.stringify(prs));
  if (cmd === "git" && args[0] === "tag") return ok(tags.join("\n"));
  throw new Error(`unexpected command ${cmd} ${args.join(" ")}`);
};

function collect(overrides: Partial<Parameters<typeof collectTrackerEvents>[0]> = {}) {
  return collectTrackerEvents({ projectDir: root, rexDir, events: COLLECTED_EVENTS, githubReads: true, exec: fakeExec, ...overrides });
}

function writeRun(id: string, run: Record<string, unknown>): void {
  writeFileSync(join(runsDir, `${id}.json`), JSON.stringify({ id, taskId: TASK, status: "running", ...run }));
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "tracker-events-"));
  rexDir = join(root, ".rex");
  runsDir = join(root, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  cpSync(V2_FIXTURE, rexDir, { recursive: true });
  expect(await changeItemLink(rexDir, CHANGE, "WM-1", "link")).toMatchObject({ ok: true });
  expect(await changeItemLink(rexDir, TASK, "WM-2", "link")).toMatchObject({ ok: true });
  prs = [];
  tags = [];
  calls = [];
});

afterEach(async () => {
  await removeTestDir(root);
});

describe("collectTrackerEvents", () => {
  it("takes a baseline on its first read and queues nothing that happened before it", async () => {
    writeRun("r-old", { startedAt: "2026-11-01T10:00:00.000Z" });
    prs = [{ number: 1, url: "https://github.com/x/y/pull/1", createdAt: "2026-11-01T10:00:00Z", mergedAt: null, body: `N-DX-Item: ${TASK}` }];
    tags = ["v0.1.0"];
    expect(await collect()).toEqual({ records: [], problems: [] });
    expect(existsSync(trackerCursorsPath(root))).toBe(true);
  });

  it("queues each event once, and not again after a restart", async () => {
    expect(await collect()).toEqual({ records: [], problems: [] });

    // A run starts on the linked task.
    writeRun("r-1", { startedAt: "2026-11-05T10:00:00.000Z" });
    expect((await collect()).records).toEqual([{ event: "run-started", rexId: TASK, ref: "WM-2" }]);

    // A PR opens carrying the task's trailer in a commit, then merges.
    const pr = { number: 7, url: "https://github.com/x/y/pull/7", createdAt: "2026-11-05T11:00:00Z", mergedAt: null, body: "Adds the button", commits: [{ messageBody: `Wire it\n\nN-DX-Item: ${TASK}` }] };
    prs = [pr];
    expect((await collect()).records).toEqual([
      { event: "pr-opened", rexId: TASK, ref: "WM-2", sources: { "pr-url": pr.url } },
    ]);
    prs = [{ ...pr, mergedAt: "2026-11-05T12:00:00Z" }];
    expect((await collect()).records).toEqual([
      { event: "pr-merged", rexId: TASK, ref: "WM-2", sources: { "pr-url": pr.url } },
    ]);

    // The change ships in 1.2.0 and the release is tagged.
    const store = await resolveStore(rexDir);
    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, CHANGE, { shippedIn: "1.2.0" } as Partial<PRDItem>);
    });
    expect((await collect()).records).toEqual([]);
    tags = ["@n-dx/core@1.2.0", "@n-dx/web@1.2.0"];
    expect((await collect()).records).toEqual([
      { event: "release-published", rexId: CHANGE, ref: "WM-1", sources: { release: "1.2.0" } },
    ]);

    // The task's runs fail twice in a row: one event, with the diagnosis summary; a third failure is no new event.
    const diagnosis = { class: "test-failure", summary: "tests fail", evidence: [], actions: [], attempt: { n: 2, of: 3 } };
    writeRun("r-1", { startedAt: "2026-11-05T10:00:00.000Z", finishedAt: "2026-11-05T10:30:00.000Z", status: "failed" });
    expect((await collect()).records).toEqual([]);
    writeRun("r-2", { startedAt: "2026-11-05T13:00:00.000Z", finishedAt: "2026-11-05T13:30:00.000Z", status: "failed", diagnosis });
    expect((await collect()).records).toEqual([
      { event: "run-started", rexId: TASK, ref: "WM-2" },
      { event: "run-failed-twice", rexId: TASK, ref: "WM-2", diagnosis: { summary: "tests fail" } },
    ]);
    writeRun("r-3", { startedAt: "2026-11-05T14:00:00.000Z", finishedAt: "2026-11-05T14:30:00.000Z", status: "timeout" });
    expect((await collect()).records).toEqual([{ event: "run-started", rexId: TASK, ref: "WM-2" }]);

    // A restarted server reads its cursors back and queues nothing it already queued.
    vi.resetModules();
    const fresh = await import("../../src/server/tracker/event-sources.js");
    expect(await fresh.collectTrackerEvents({ projectDir: root, rexDir, events: fresh.COLLECTED_EVENTS, githubReads: true, exec: fakeExec }))
      .toEqual({ records: [], problems: [] });
  });

  it("names the nearest linked item, and drops an event no item links for", async () => {
    await collect();
    expect(await changeItemLink(rexDir, TASK, "WM-2", "unlink")).toMatchObject({ ok: true, changed: true });
    writeRun("r-1", { startedAt: "2026-11-05T10:00:00.000Z" });
    expect((await collect()).records).toEqual([{ event: "run-started", rexId: CHANGE, ref: "WM-1" }]);

    expect(await changeItemLink(rexDir, CHANGE, "WM-1", "unlink")).toMatchObject({ ok: true, changed: true });
    writeRun("r-2", { startedAt: "2026-11-05T11:00:00.000Z" });
    expect((await collect()).records).toEqual([]);
  });

  it("reads only the sources whose rule is not off, and runs no gh while GitHub reads are off", async () => {
    expect(await collect({ events: ["run-started"] })).toEqual({ records: [], problems: [] });
    expect(calls).toEqual([]);

    const result = await collect({ events: ["pr-opened"], githubReads: false });
    expect(result.problems).toEqual([expect.stringContaining("web.sidecarGithubReads")]);
    expect(calls).toEqual([]);
  });

  it("carries the CODEOWNERS owner of a PR's files beside its URL", async () => {
    mkdirSync(join(root, ".github"), { recursive: true });
    writeFileSync(join(root, ".github", "CODEOWNERS"), "*  @core\n/packages/web/ @hal\n");
    await collect({ events: ["pr-opened"] });
    const url = "https://github.com/x/y/pull/4";
    prs = [{ number: 4, url, createdAt: "2026-11-05T11:00:00Z", body: `N-DX-Item: ${TASK}`, files: [{ path: "packages/web/src/a.ts" }] }];
    expect((await collect({ events: ["pr-opened"] })).records).toEqual([
      { event: "pr-opened", rexId: TASK, ref: "WM-2", sources: { "pr-url": url, codeowners: "@hal" } },
    ]);
  });

  it("keeps a source's cursor when gh fails, so the next read still sees the PR", async () => {
    await collect({ events: ["pr-opened"] });
    const failing: TrackerEventExec = async () => ({ launched: true, exitCode: 1, stdout: "", stderr: "HTTP 502\nmore", error: null }) as ExecResult;
    prs = [{ number: 3, url: "https://github.com/x/y/pull/3", createdAt: "2026-11-05T11:00:00Z", body: `N-DX-Item: https://dash.example/items/${TASK}` }];
    expect(await collect({ events: ["pr-opened"], exec: failing })).toEqual({ records: [], problems: ["gh pr list answered: HTTP 502"] });
    expect((await collect({ events: ["pr-opened"] })).records).toEqual([
      { event: "pr-opened", rexId: TASK, ref: "WM-2", sources: { "pr-url": "https://github.com/x/y/pull/3" } },
    ]);
  });
});

describe("parsing", () => {
  it("reads N-DX-Item trailers, bare or as a permalink", () => {
    expect(itemTrailerIds("feat: x\n\nN-DX: claude\nN-DX-Item: abc-1\nn-dx-item: https://h/items/abc-2?x=1\nN-DX-Item: abc-1")).toEqual(["abc-1", "abc-2"]);
    expect(itemTrailerIds("mentions N-DX-Item: abc-3 mid-line")).toEqual([]);
  });

  it("reads release versions from v-tags and package tags", () => {
    expect([...tagVersions(["v1.0.0", "@n-dx/web@0.9.0", "@n-dx/core@0.9.0", "v2.0.0-rc.1", "nightly"])]).toEqual(["1.0.0", "0.9.0"]);
  });
});
