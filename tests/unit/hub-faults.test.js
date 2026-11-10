/**
 * Hub-side faults are repaired by the hub or by the next `ndx` command, and
 * none of their messages sends the operator to `ndx hub stop` or `ndx start`.
 *
 * - A hub that reports a fault on `/api/hub/health` (no n-dx binary for
 *   project servers, no n-dx CLI for extensions) is replaced by `ndx start`
 *   through the stale-hub path, given both.
 * - A sidecar stop the hub does not confirm no longer fails the extension
 *   command with "restart the hub with ndx hub stop": the command's result
 *   stands, and it says the hub stops the sidecar itself.
 *
 * Everything here runs in a temporary ndx home against a stand-in hub on a
 * free port; nothing reaches a real hub.
 *
 * @see packages/core/hub-replacement.js — hubFaultReason
 * @see packages/core/extension-env.js — stopExtensionSidecar, sidecarStopNote
 * @see packages/web/tests/integration/hub-faults.test.ts — the hub's own side
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hubFaultReason, hubReplacementNotice, planHubReplacement } from "../../packages/core/hub-replacement.js";
import { sidecarStopNote, stopExtensionSidecar } from "../../packages/core/extension-env.js";

/** None of these may tell the operator to stop or start anything by hand. */
function expectNoManualRestart(text) {
  expect(text).not.toMatch(/ndx hub stop/);
  expect(text).not.toMatch(/ndx start/);
  expect(text).not.toMatch(/\brestart\b/i);
}

describe("hubFaultReason", () => {
  it("is null for a hub that reports no faults, or predates the field", () => {
    expect(hubFaultReason([])).toBeNull();
    expect(hubFaultReason(undefined)).toBeNull();
    expect(hubFaultReason("no-ndx-cli")).toBeNull();
  });

  it("names a hub with no n-dx binary or CLI as one to replace, through the stale-hub path", () => {
    const reason = hubFaultReason(["no-ndx-bin", "no-ndx-cli"]);
    expect(reason).toEqual({
      kind: "fault",
      text: "it cannot tell which n-dx binary to start project servers from, and it has no n-dx CLI to ask about extensions",
    });
    const idle = { runs: [], mcpSessions: [] };
    expect(planHubReplacement({ reason, liveWork: idle, force: false, port: 4100 })).toMatchObject({ action: "replace" });
    expectNoManualRestart(hubReplacementNotice(reason, 4100, 3, null));
  });
});

describe("sidecarStopNote", () => {
  it("reports what the hub answered and that the hub stops the sidecar itself", () => {
    const note = sidecarStopNote("recon", 500);
    expect(note).toContain("recon");
    expect(note).toContain("HTTP 500");
    expect(note).toContain("stops one that is no longer enabled");
    expectNoManualRestart(note);
    expect(sidecarStopNote("recon", null, "The operation was aborted due to timeout")).toContain("timeout");
  });
});

describe("stopExtensionSidecar", () => {
  let home;
  let server;
  let answer;
  const seen = [];

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "ndx-sidecar-stop-"));
    seen.length = 0;
    answer = 200;
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers["x-ndx-token"] ?? ""}`);
      res.writeHead(answer, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ stopped: answer === 200 }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: process.pid, port: server.address().port }));
    writeFileSync(join(home, "auth.token"), "tok\n");
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  });

  it("asks this home's hub to stop the sidecar, with the token", async () => {
    expect(await stopExtensionSidecar(home, "recon")).toEqual({ stopped: true });
    expect(seen).toEqual(["POST /api/hub/extensions/recon/stop tok"]);
  });

  it("returns a note, never throws, when the hub does not confirm the stop", async () => {
    answer = 500;
    const result = await stopExtensionSidecar(home, "recon");
    expect(result.stopped).toBe(false);
    expect(result.note).toContain("HTTP 500");
    expectNoManualRestart(result.note);
  });

  it("returns a note when the hub cannot be reached at all", async () => {
    const result = await stopExtensionSidecar(home, "recon", {
      fetchImpl: async () => { throw new Error("connect ECONNREFUSED"); },
    });
    expect(result).toMatchObject({ stopped: false });
    expect(result.note).toContain("ECONNREFUSED");
  });

  it("has nothing to stop when no hub is running", async () => {
    rmSync(join(home, "hub.pid"));
    expect(await stopExtensionSidecar(home, "recon")).toEqual({ stopped: false });
    expect(seen).toEqual([]);
  });
});
