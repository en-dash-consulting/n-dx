/**
 * The tracker routes behind the real request gate (with the Sidecar broker
 * credential accepted where start.ts accepts it) and the `web.sidecar` route
 * gate: the tick answers the per-user token only, refusing no credential, a
 * browser session and a Sidecar broker credential; the activity log is read
 * back as written.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { handleRequestSecurity, isPublicOnlyRequest, refusePublicOnly } from "../../src/server/request-security.js";
import { enforceRouteFeatureGate } from "../../src/server/route-feature-gates.js";
import { handleTrackerRoute } from "../../src/server/routes-tracker.js";
import { isSidecarBrokerRequest, SIDECAR_BROKER_KEY_HEADER, sidecarBrokerCredential } from "../../src/server/sidecar/broker-credential.js";
import { appendTrackerActivity, type TrackerActivityEntry } from "../../src/server/tracker/activity-log.js";
import { changeItemLink } from "../../src/server/tracker/item-links.js";
import { enqueueTrackerEvent } from "../../src/server/tracker/sync-engine.js";
import type { ServerContext } from "../../src/server/types.js";
import { CredentialStore } from "../../src/shared/index.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

const TOKEN = "dashboard-token-0123456789abcdef";
const TASK = "c0000000-0000-4000-8000-000000000002";
const auth = { "X-Ndx-Token": TOKEN };

let root: string;
let ndxHome: string;
let server: RouteTestServer;
let service: ConnectionService;
let credentials: CredentialStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "tracker-routes-"));
  ndxHome = mkdtempSync(join(tmpdir(), "tracker-routes-home-"));
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: true } } }));
  writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({
    connections: { caos: { transport: "http", url: "http://127.0.0.1:9/mcp", profile: "caos" } },
    trackerSync: { connection: "caos", project: "ndx", rules: { "run-started": "dry-run" } },
  }));
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {} });
  credentials = new CredentialStore();
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  server = await startRouteTestServer(async (req, res) => {
    // As start.ts's dispatcher.
    if (handleRequestSecurity(req, res, { token: TOKEN, credentials, scopedCredential: isSidecarBrokerRequest })) return true;
    if (isPublicOnlyRequest(req)) return refusePublicOnly(req, res);
    if (enforceRouteFeatureGate(req, res, ctx)) return true;
    return handleTrackerRoute(req, res, ctx, { connectionsFor: () => service });
  });
});

afterEach(async () => {
  await service.close();
  await server.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

const tick = (headers: Record<string, string> = auth) => fetch(`${server.baseUrl}/api/tracker/sync/tick`, { method: "POST", headers });

describe("POST /api/tracker/sync/tick", () => {
  it("refuses a request without the per-user token", async () => {
    expect((await tick({})).status).toBe(401);
    expect((await tick({ "X-Ndx-Token": "nope" })).status).toBe(401);
  });

  it("refuses a browser session", async () => {
    const { credential } = credentials.mintSession();
    const res = await tick({ Authorization: `Bearer ${credential}` });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("per-user token");
  });

  it("refuses a Sidecar broker credential", async () => {
    const res = await tick({ [SIDECAR_BROKER_KEY_HEADER]: sidecarBrokerCredential("tracker-test") });
    expect(res.status).toBe(401);
  });

  it("runs the queued events on the per-user token", async () => {
    enqueueTrackerEvent(root, { event: "run-started", rexId: "rex-1", ref: "WM-1" });
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "ran", queued: 0, entries: [{ result: "would", requestId: "ndx:ndx:rex-1:run-started" }] });
    expect((await fetch(`${server.baseUrl}/api/tracker/sync/tick`, { headers: auth })).status).toBe(405);
  });

  it("collects the ndx events since the last tick and runs them", async () => {
    cpSync(resolve(__dirname, "../../../rex/tests/fixtures/v2-tree"), join(root, ".rex"), { recursive: true });
    expect(await changeItemLink(join(root, ".rex"), TASK, "WM-2", "link")).toMatchObject({ ok: true });
    // The first tick takes the baseline.
    expect(await (await tick()).json()).toMatchObject({ state: "ran", entries: [], collected: { queued: 0, problems: [] } });

    const runsDir = join(root, ".hench", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "r-1.json"), JSON.stringify({ id: "r-1", taskId: TASK, status: "running", startedAt: "2026-11-05T10:00:00.000Z" }));
    expect(await (await tick()).json()).toMatchObject({
      state: "ran",
      collected: { queued: 1, problems: [] },
      entries: [{ result: "would", requestId: `ndx:ndx:${TASK}:run-started`, call: { args: { workItemId: "WM-2" } } }],
    });
    expect(await (await tick()).json()).toMatchObject({ entries: [], collected: { queued: 0 } });
  });

  it("is off with web.sidecar", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: false } } }));
    expect((await tick()).status).toBe(403);
  });
});

describe("GET /api/tracker/activity", () => {
  it("answers the log as written, and needs a credential", async () => {
    const entry: TrackerActivityEntry = {
      at: "2026-11-05T12:00:00.000Z", event: "pr-merged", rexId: "rex-1", rule: "move", mode: "on",
      requestId: "ndx:ndx:rex-1:pr-merged",
      call: { tool: "move_work_item", args: { requestId: "ndx:ndx:rex-1:pr-merged", workItemId: "WM-1", toStatus: "pendingDelivery" } },
      result: "ok",
    };
    appendTrackerActivity(root, entry);
    expect((await fetch(`${server.baseUrl}/api/tracker/activity`)).status).toBe(401);
    const res = await fetch(`${server.baseUrl}/api/tracker/activity`, { headers: auth });
    expect(await res.json()).toEqual({ entries: [entry], sources: [] });
  });

  it("answers why a rule that is on reads nothing, until GitHub reads are turned on", async () => {
    cpSync(resolve(__dirname, "../../../rex/tests/fixtures/v2-tree"), join(root, ".rex"), { recursive: true });
    const local = JSON.parse(readFileSync(join(root, ".n-dx.local.json"), "utf-8"));
    local.trackerSync.rules = { "pr-merged": "on" };
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify(local));
    const sources = async () => (await (await fetch(`${server.baseUrl}/api/tracker/activity`, { headers: auth })).json()).sources;

    expect((await tick()).status).toBe(200);
    expect(await sources()).toEqual([{ event: "pr-merged", problem: expect.stringContaining("web.sidecarGithubReads"), at: expect.any(String) }]);

    // The rule is turned off: nothing is read, so nothing is wrong.
    local.trackerSync.rules = {};
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify(local));
    expect((await tick()).status).toBe(200);
    expect(await sources()).toEqual([]);
  });
});
