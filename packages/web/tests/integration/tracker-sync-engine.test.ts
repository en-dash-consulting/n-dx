/**
 * Tracker sync over a real ConnectionService and a fake CAOS-shaped MCP server
 * (never CAOS), with the project's trackerSync settings in a temp
 * `.n-dx.local.json`: rules are off until set, dry-run logs the would-be call
 * and calls nothing, `on` makes a move with its request id, a duplicate is
 * confirmed with a read, create and blocked raise cards, a refusal is logged
 * with its problems and never retried, and an unreachable connection keeps
 * the event queued.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { resolveStore } from "@n-dx/rex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "../../src/server/connections/connection-config.js";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { pendingCards, readTrackerActivity, trackerActivityPath } from "../../src/server/tracker/activity-log.js";
import { decideTrackerCard, enqueueTrackerEvent, queuedTrackerEvents, runTrackerSyncTick } from "../../src/server/tracker/sync-engine.js";
import type { TrackerEventRecord } from "../../src/server/tracker/rules.js";
import { collectTrackerEvents } from "../../src/server/tracker/event-sources.js";
import { findItemByRef } from "../../src/server/tracker/item-links.js";
import { itemLinkRefs, type LinkFields } from "../../src/server/tracker/link-refs.js";
import { USER_PROFILES_DIR } from "../../src/server/tracker/server-profiles.js";
import { addCaosTools, type CaosReply } from "../fixtures/connections/fake-mcp-tools.mjs";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

let root: string;
let ndxHome: string;
let fake: FakeMcpHttpServer;
let service: ConnectionService | undefined;
let replies: Record<string, CaosReply>;

const AT = new Date("2026-11-05T12:00:00.000Z");
const V2_FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

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

  it("logs a move missing a required fact as a card naming it, and makes no call", async () => {
    settings({ "pr-opened": "on" });
    const { entries } = await tick({ ...prOpened, values: {} });
    expect(entries).toEqual([expect.objectContaining({
      rule: "move",
      result: "card",
      problems: [{ message: expect.stringContaining("missing reviewer") }],
    })]);
    expect(toolCalls()).toEqual([]);
  });

  it("skips creation for an item that already links to a work item, and a move for one that links to none", async () => {
    settings({ "change-captured": "on", "run-started": "on" });
    const { entries } = await tick({ event: "change-captured", rexId: "rex-2", ref: "WM-9" }, { event: "run-started", rexId: "rex-3" });
    expect(entries).toEqual([]);
    expect(toolCalls()).toEqual([]);
  });
});

describe("deciding a card", () => {
  const created: TrackerEventRecord = { event: "change-captured", rexId: "rex-2", values: { title: "Sidecar tracker sync" } };
  const requestId = "ndx:ndx:rex-2:change-captured";
  const decide = (decision: Parameters<typeof decideTrackerCard>[2], id = requestId) =>
    decideTrackerCard({ projectDir: root, rexDir: join(root, ".rex"), service: connect(), now: () => AT, profiles: { ndxHome } }, id, decision);

  it("approves a card once: makes the call with the operator's edits, keeps the request id, and records the result", async () => {
    settings({ "change-captured": "on" });
    replies.create_work_item = json({ id: "WM-7" });
    await tick(created);
    const decided = await decide({ action: "approve", args: { title: "Edited title", epicId: "e-1", requestId: "forged", initialStatus: "backlog" } });
    expect(decided).toMatchObject({ ok: true, entry: { result: "ok", requestId, call: { tool: "create_work_item", args: { title: "Edited title", requestId } } } });
    expect(toolCalls().map((c) => [c.name, c.arguments])).toEqual([
      ["create_work_item", { title: "Edited title", epicId: "e-1", requestId, initialStatus: "backlog" }],
      ["get_work_item", { workItemId: "WM-7" }],
    ]);
    expect(readTrackerActivity(root).map((e) => e.result)).toEqual(["card", "ok"]);

    // The card is closed: a second approval, or a dismissal, makes no call.
    expect(await decide({ action: "approve", args: {} })).toMatchObject({ ok: false, status: 409 });
    expect(await decide({ action: "dismiss" })).toMatchObject({ ok: false, status: 409 });
    expect(toolCalls()).toHaveLength(2);
  });

  it("makes one call for two approvals sent together", async () => {
    settings({ "change-captured": "on" });
    replies.create_work_item = json({ id: "WM-7" });
    await tick(created);
    const args = { title: "T", epicId: "e-1" };
    const results = await Promise.all([decide({ action: "approve", args }), decide({ action: "approve", args })]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(toolCalls().filter((c) => c.name === "create_work_item")).toHaveLength(1);
  });

  it("records a refusal with its problems, and the card is closed", async () => {
    settings({ "change-captured": "on" });
    replies.create_work_item = () => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "validation_failed", problems: [{ field: "title", message: "too long" }] }) }] });
    await tick(created);
    expect(await decide({ action: "approve", args: { title: "T", epicId: "e-1" } })).toMatchObject({
      ok: true,
      entry: { result: "refused", problems: [{ field: "title", message: "too long" }] },
    });
    expect(await decide({ action: "dismiss" })).toMatchObject({ ok: false, status: 409 });
  });

  it("dismisses a card without a call and records it dismissed", async () => {
    settings({ "change-captured": "on" });
    await tick(created);
    expect(await decide({ action: "dismiss" })).toMatchObject({ ok: true, entry: { result: "dismissed", requestId } });
    expect(toolCalls()).toEqual([]);
    expect(readTrackerActivity(root).map((e) => e.result)).toEqual(["card", "dismissed"]);
    // A tick that sees the event again plans nothing for it.
    expect((await tick(created)).entries).toEqual([]);
  });

  it("refuses a request id that is no card", async () => {
    settings({ "run-started": "dry-run" });
    await tick(runStarted);
    expect(await decide({ action: "dismiss" }, "ndx:ndx:rex-1:run-started")).toMatchObject({ ok: false, status: 409 });
  });

  it("leaves the card waiting when the connection cannot be reached", async () => {
    settings({ "change-captured": "on" });
    await tick(created);
    await fake.close();
    const decided = await decide({ action: "approve", args: { title: "T", epicId: "e-1" } });
    expect(decided).toMatchObject({ ok: true, entry: { result: expect.stringMatching(/^(unavailable|needs-sign-in)$/) } });
    expect(pendingCards(readTrackerActivity(root)).map((e) => e.requestId)).toEqual([requestId]);
  });
});

describe("an approved create links the change", () => {
  const CHANGE = "c0000000-0000-4000-8000-000000000001";
  const captured: TrackerEventRecord = { event: "change-captured", rexId: CHANGE, values: { title: "Sidecar tracker sync" } };
  const rexDir = () => join(root, ".rex");
  const approve = (requestId = `ndx:ndx:${CHANGE}:change-captured`) =>
    decideTrackerCard({ projectDir: root, rexDir: rexDir(), service: connect(), now: () => AT, profiles: { ndxHome } }, requestId, {
      action: "approve",
      args: { title: "T", epicId: "e-1" },
    });
  const issuesOf = async (id: string) => {
    const doc = await (await resolveStore(rexDir())).loadDocument();
    return itemLinkRefs(findItemByRef(doc.items, id) as LinkFields);
  };

  beforeEach(() => {
    cpSync(V2_FIXTURE, rexDir(), { recursive: true });
  });

  it("writes the created work item onto the change, so a later run start plans a move", async () => {
    settings({ "change-captured": "on", "run-started": "on" });
    replies.create_work_item = json({ id: "WM-7" });
    const runs = join(root, ".hench", "runs");
    mkdirSync(runs, { recursive: true });
    const collect = () => collectTrackerEvents({ projectDir: root, rexDir: rexDir(), events: ["run-started"], githubReads: false });
    // The first read takes the baseline.
    expect((await collect()).records).toEqual([]);

    await tick(captured);
    const decided = await approve();
    expect(decided).toMatchObject({ ok: true, entry: { result: "ok", workItemId: "WM-7" } });
    expect(decided.ok && decided.entry.problems).toBeFalsy();
    expect(await issuesOf(CHANGE)).toEqual(["WM-7"]);

    writeFileSync(join(runs, "r-1.json"), JSON.stringify({ id: "r-1", taskId: CHANGE, status: "running", startedAt: new Date().toISOString() }));
    const { records } = await collect();
    expect(records).toEqual([{ event: "run-started", rexId: CHANGE, ref: "WM-7" }]);
    const { entries } = await tick(...records);
    expect(entries).toEqual([expect.objectContaining({ rule: "move", result: "ok" })]);
    expect(toolCalls().at(-1)).toEqual({
      name: "move_work_item",
      arguments: { requestId: `ndx:ndx:${CHANGE}:run-started`, workItemId: "WM-7", toStatus: "inProgress" },
    });
  });

  it("links an opaque id through the URL the profile builds, so a later run start moves that item", async () => {
    const id = "3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0";
    const url = "https://www.notion.so/3b3a80b7192480f7b5fce8093ba5f7f0";
    settings({ "change-captured": "on", "run-started": "on" });
    replies.create_work_item = json({ id });
    const runs = join(root, ".hench", "runs");
    mkdirSync(runs, { recursive: true });
    const collect = () => collectTrackerEvents({ projectDir: root, rexDir: rexDir(), events: ["run-started"], githubReads: false });
    expect((await collect()).records).toEqual([]);

    await tick(captured);
    const decided = await approve();
    expect(decided).toMatchObject({ ok: true, entry: { result: "ok", workItemId: id } });
    expect(decided.ok && decided.entry.problems).toBeFalsy();
    expect(await issuesOf(CHANGE)).toEqual([url]);

    writeFileSync(join(runs, "r-1.json"), JSON.stringify({ id: "r-1", taskId: CHANGE, status: "running", startedAt: new Date().toISOString() }));
    const { records } = await collect();
    expect(records).toEqual([{ event: "run-started", rexId: CHANGE, ref: url }]);
    const { entries } = await tick(...records);
    expect(entries).toEqual([expect.objectContaining({ rule: "move", result: "ok" })]);
    expect(toolCalls().at(-1)).toEqual({
      name: "move_work_item",
      arguments: { requestId: `ndx:ndx:${CHANGE}:run-started`, workItemId: id, toStatus: "inProgress" },
    });
  });

  it("keeps an opaque id unlinked, naming the problem, under a profile with no item URL template", async () => {
    const caos = JSON.parse(readFileSync(resolve(__dirname, "../../src/server/tracker/profiles/caos.json"), "utf8"));
    delete caos.tracker.itemUrlTemplate;
    mkdirSync(join(ndxHome, USER_PROFILES_DIR), { recursive: true });
    writeFileSync(join(ndxHome, USER_PROFILES_DIR, "plain.json"), JSON.stringify(caos));
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ trackerSync: { connection: "caos", profile: "user:plain", project: "ndx", rules: { "change-captured": "on" } } }));
    const id = "3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0";
    replies.create_work_item = json({ id });
    await tick(captured);
    const decided = await approve();
    expect(decided).toMatchObject({
      ok: true,
      entry: { result: "ok", workItemId: id, problems: [{ message: expect.stringMatching(new RegExp(`^created ${id}, but could not link ${CHANGE} to it: .*tracker key`)) }] },
    });
    expect(await issuesOf(CHANGE)).toEqual([]);
  });

  it("records the created item and names the link failure when the link cannot be written", async () => {
    settings({ "change-captured": "on" });
    replies.create_work_item = json({ id: "WM-8" });
    await tick({ ...captured, rexId: "no-such-change" });
    const decided = await approve("ndx:ndx:no-such-change:change-captured");
    expect(decided).toMatchObject({
      ok: true,
      entry: { result: "ok", workItemId: "WM-8", problems: [{ message: expect.stringMatching(/^created WM-8, but could not link no-such-change to it: .*not found/) }] },
    });
    expect(readTrackerActivity(root).at(-1)).toEqual(decided.ok && decided.entry);
    expect(pendingCards(readTrackerActivity(root))).toEqual([]);
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
