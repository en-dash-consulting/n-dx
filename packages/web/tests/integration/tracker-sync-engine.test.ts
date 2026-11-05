/**
 * Tracker sync over a real ConnectionService and a fake CAOS-shaped MCP server
 * (never CAOS), with the project's trackerSync settings in a temp
 * `.n-dx.local.json`: rules are off until set, dry-run logs the would-be call
 * and calls nothing, `on` makes a move with its request id, a duplicate is
 * confirmed with a read, create and blocked raise cards, a refusal is logged
 * with its problems and never retried, and an unreachable connection keeps
 * the event queued.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "../../src/server/connections/connection-config.js";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { readTrackerActivity, trackerActivityPath } from "../../src/server/tracker/activity-log.js";
import { enqueueTrackerEvent, queuedTrackerEvents, runTrackerSyncTick } from "../../src/server/tracker/sync-engine.js";
import type { TrackerEventRecord } from "../../src/server/tracker/rules.js";
import { addCaosTools, type CaosReply } from "../fixtures/connections/fake-mcp-tools.mjs";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

let root: string;
let ndxHome: string;
let fake: FakeMcpHttpServer;
let service: ConnectionService | undefined;
let replies: Record<string, CaosReply>;

const AT = new Date("2026-11-05T12:00:00.000Z");

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "tracker-sync-"));
  ndxHome = mkdtempSync(join(tmpdir(), "tracker-sync-home-"));
  replies = {};
  fake = await startFakeMcpHttpServer({ extraTools: (server) => addCaosTools(server, replies) });
});

afterEach(async () => {
  // With no settings a tick drops whatever this temp project left queued.
  writeFileSync(join(root, ".n-dx.local.json"), "{}");
  await runTrackerSyncTick({ projectDir: root, service: connect() });
  await service?.close();
  service = undefined;
  await fake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

function connect(url = fake.url): ConnectionService {
  if (service) return service;
  const caos = { id: "caos", label: "CAOS", auth: "none", transport: "http", url, profile: "caos" } as ConnectionConfig;
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {}, connections: [caos] });
  return service;
}

function settings(rules: Record<string, string> = {}): void {
  writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ trackerSync: { connection: "caos", project: "ndx", rules } }));
}

async function tick(...records: TrackerEventRecord[]) {
  for (const record of records) enqueueTrackerEvent(root, record);
  const result = await runTrackerSyncTick({ projectDir: root, service: connect(), now: () => AT, profiles: { ndxHome } });
  if (result.state !== "ran") throw new Error(`tick did not run: ${JSON.stringify(result)}`);
  return result;
}

/** Every tools/call the fake received. */
const toolCalls = () => fake.calls;
const runStarted: TrackerEventRecord = { event: "run-started", rexId: "rex-1", ref: "WM-1" };
const prOpened: TrackerEventRecord = {
  event: "pr-opened",
  rexId: "rex-1",
  ref: "WM-1",
  values: { "review.reviewerNotionUserId": "u-1" },
  sources: { "pr-url": "https://github.com/x/y/pull/1" },
};
const json = (value: unknown): CaosReply => () => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("rule modes", () => {
  it("does nothing while a rule is off, which every rule is by default", async () => {
    settings();
    const result = await tick(runStarted, { event: "change-captured", rexId: "rex-2" }, { event: "run-failed-twice", rexId: "rex-1", ref: "WM-1" });
    expect(result.entries).toEqual([]);
    expect(toolCalls()).toEqual([]);
    expect(readTrackerActivity(root)).toEqual([]);
  });

  it("logs a dry-run rule's would-be call and makes none", async () => {
    settings({ "run-started": "dry-run" });
    const { entries } = await tick(runStarted);
    expect(entries).toEqual([{
      at: AT.toISOString(),
      event: "run-started",
      rexId: "rex-1",
      rule: "move",
      mode: "dry-run",
      requestId: "ndx:ndx:rex-1:run-started",
      call: { tool: "move_work_item", args: { requestId: "ndx:ndx:rex-1:run-started", workItemId: "WM-1", toStatus: "inProgress" } },
      result: "would",
    }]);
    expect(toolCalls()).toEqual([]);
    expect(readTrackerActivity(root)).toEqual(entries);
  });

  it("makes a move whose rule is on through the connection, with the request id", async () => {
    settings({ "run-started": "on", "pr-merged": "on" });
    const { entries } = await tick(runStarted, { event: "pr-merged", rexId: "rex-1", ref: "WM-1" });
    expect(entries.map((e) => [e.event, e.result])).toEqual([["run-started", "ok"], ["pr-merged", "ok"]]);
    expect(toolCalls()).toEqual([
      { name: "move_work_item", arguments: { requestId: "ndx:ndx:rex-1:run-started", workItemId: "WM-1", toStatus: "inProgress" } },
      { name: "move_work_item", arguments: { requestId: "ndx:ndx:rex-1:pr-merged", workItemId: "WM-1", toStatus: "pendingDelivery" } },
    ]);

    // A settled event queued again is not called again.
    await tick(runStarted);
    expect(toolCalls()).toHaveLength(2);
  });

  it("names the project after its directory when trackerSync.project is unset", async () => {
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ trackerSync: { connection: "caos", rules: { "run-started": "dry-run" } } }));
    const { entries } = await tick(runStarted);
    expect(entries[0].requestId).toBe(`ndx:${basename(root)}:rex-1:run-started`);
  });
});

describe("cards", () => {
  it("raises a card for creation and for blocked instead of calling, even with the rule on", async () => {
    settings({ "change-captured": "on", "run-failed-twice": "on" });
    const { entries } = await tick(
      { event: "change-captured", rexId: "rex-2", values: { title: "Sidecar tracker sync" } },
      { event: "run-failed-twice", rexId: "rex-1", ref: "WM-1", values: { "stalled.kind": "blocked" } },
    );
    expect(entries).toEqual([
      expect.objectContaining({
        rule: "create",
        result: "card",
        call: { tool: "create_work_item", args: { title: "Sidecar tracker sync", requestId: "ndx:ndx:rex-2:change-captured", initialStatus: "backlog" } },
      }),
      expect.objectContaining({
        rule: "blocked",
        result: "card",
        call: { tool: "move_work_item", args: { stalled: { kind: "blocked" }, requestId: "ndx:ndx:rex-1:run-failed-twice", workItemId: "WM-1", toStatus: "blocked" } },
      }),
    ]);
    expect(toolCalls()).toEqual([]);
  });

  it("skips creation for an item that already links to a work item, and a move for one that links to none", async () => {
    settings({ "change-captured": "on", "run-started": "on" });
    const { entries } = await tick({ event: "change-captured", rexId: "rex-2", ref: "WM-9" }, { event: "run-started", rexId: "rex-3" });
    expect(entries).toEqual([]);
    expect(toolCalls()).toEqual([]);
  });
});

describe("tracker replies", () => {
  it("confirms a duplicate reply with a read before logging it as duplicate", async () => {
    settings({ "run-started": "on" });
    replies.move_work_item = json({ duplicate: true, id: "WM-1" });
    const { entries } = await tick(runStarted);
    expect(toolCalls().map((c) => c.name)).toEqual(["move_work_item", "get_work_item"]);
    expect(toolCalls()[1].arguments).toEqual({ workItemId: "WM-1" });
    expect(entries[0]).toMatchObject({ result: "duplicate", requestId: "ndx:ndx:rex-1:run-started" });
  });

  it("does not log a duplicate the read cannot confirm", async () => {
    settings({ "run-started": "on" });
    replies.move_work_item = json({ duplicate: true });
    replies.get_work_item = () => ({ isError: true, content: [{ type: "text", text: "no work item WM-1" }] });
    const { entries } = await tick(runStarted);
    expect(entries[0]).toMatchObject({ result: "refused", problems: [{ message: expect.stringContaining("could not confirm WM-1") }] });
  });

  it("logs a validation_failed refusal with its problems and never retries the event, with any arguments", async () => {
    settings({ "pr-opened": "on" });
    replies.move_work_item = () => ({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "validation_failed", problems: [{ field: "review.reviewerNotionUserId", message: "is required" }] }) }],
    });
    const { entries } = await tick(prOpened);
    expect(entries).toEqual([expect.objectContaining({
      result: "refused",
      problems: [{ field: "review.reviewerNotionUserId", message: "is required" }],
    })]);
    expect(toolCalls()).toHaveLength(1);

    // The same event again, now with a value: not called, not logged again.
    const again = await tick({ ...prOpened, values: { "review.reviewerNotionUserId": "u-2" } });
    expect(again.entries).toEqual([]);
    expect(toolCalls()).toHaveLength(1);
    expect(readTrackerActivity(root)).toHaveLength(1);
  });

  it("does not let an overlapping tick retry a refusal still in flight", async () => {
    settings({ "pr-opened": "on" });
    replies.move_work_item = () => ({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "validation_failed", problems: ["reviewer is required"] }) }],
    });
    enqueueTrackerEvent(root, prOpened);
    const first = runTrackerSyncTick({ projectDir: root, service: connect(), profiles: { ndxHome } });
    // The same event again, queued while the first tick's call is in flight, and a second tick.
    enqueueTrackerEvent(root, { ...prOpened, values: { "review.reviewerNotionUserId": "u-2" } });
    const second = runTrackerSyncTick({ projectDir: root, service: connect(), profiles: { ndxHome } });
    await Promise.all([first, second]);
    expect(toolCalls()).toHaveLength(1);
    expect(readTrackerActivity(root).map((e) => e.result)).toEqual(["refused"]);
  });
});

describe("an unreachable connection", () => {
  it("logs unavailable and keeps the event queued, unchanged, for the next tick", async () => {
    const closed = await startFakeMcpHttpServer();
    const url = closed.url;
    await closed.close();
    connect(url);
    settings({ "run-started": "on" });
    const result = await tick(runStarted);
    expect(result.entries).toEqual([expect.objectContaining({ result: "unavailable", problems: [{ message: expect.stringContaining("connection unavailable") }] })]);
    expect(queuedTrackerEvents(root)).toEqual([runStarted]);
    expect(result.queued).toBe(1);

    // Every later tick still fails, and logs nothing new until the result changes.
    const again = await tick();
    expect(again.entries).toEqual([]);
    expect(again.queued).toBe(1);
    expect(readTrackerActivity(root)).toHaveLength(1);
  });
});

describe("the activity log", () => {
  it("starts an entry on its own line after a fragment a crash left mid-append", async () => {
    settings({ "run-started": "dry-run" });
    mkdirSync(join(root, ".hench", "sidecar"), { recursive: true });
    writeFileSync(trackerActivityPath(root), '{"at":"2026-11-05T11:00:00.000Z","eve');
    await tick(runStarted);
    expect(readTrackerActivity(root)).toEqual([expect.objectContaining({ result: "would", requestId: "ndx:ndx:rex-1:run-started" })]);
  });
});

describe("settings", () => {
  it("drops the queue while the project declares no tracker sync", async () => {
    enqueueTrackerEvent(root, runStarted);
    expect(await runTrackerSyncTick({ projectDir: root, service: connect() })).toEqual({ state: "off" });
    expect(queuedTrackerEvents(root)).toEqual([]);
  });

  it("reports malformed settings and keeps the queue", async () => {
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ trackerSync: { connection: "caos", rules: { "run-started": "always" } } }));
    enqueueTrackerEvent(root, runStarted);
    expect(await runTrackerSyncTick({ projectDir: root, service: connect() })).toEqual({
      state: "invalid",
      problems: ["trackerSync.rules.run-started must be off, dry-run or on"],
    });
    expect(queuedTrackerEvents(root)).toEqual([runStarted]);
  });
});
