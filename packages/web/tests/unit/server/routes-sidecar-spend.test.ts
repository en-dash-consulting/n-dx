/**
 * Direct route requests with the production registry defaults. Only the
 * vendor connection is replaced; no socket, subprocess or vendor is used.
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { afterEach, expect, it, vi } from "vitest";
import { dashboardUsagePath } from "../../../src/server/dashboard-usage.js";
import { handleSidecarRoute, type SidecarFramesMessage } from "../../../src/server/routes-sidecar.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

vi.mock("../../../src/server/sidecar/session-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/sidecar/session-registry.js")>();
  return {
    ...actual,
    // Do not supply registryFor or recreate onTurnSpend: defaultRegistryFor
    // must supply every option, including the recorder under test.
    createWorktreeSidecarRegistry: ((projectDir, defaults) => new actual.SidecarSessionRegistry({
      ...defaults,
      dir: actual.worktreeSidecarDir(projectDir),
      connect: () => ({ spawn: scriptedSpawn }),
    })) satisfies typeof actual.createWorktreeSidecarRegistry,
  };
});

/** A completed Claude stream-json turn with known usage; no child is launched. */
const scriptedSpawn: NonNullable<VendorSessionOptions["spawn"]> = () => {
  const child = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null });
  stdin.resume();
  stdin.on("finish", () => {
    for (const frame of [
      { type: "system", subtype: "init", session_id: "scripted-session" },
      { type: "assistant", message: { id: "reply", content: [{ type: "text", text: "Done." }], usage: { input_tokens: 10, output_tokens: 4 } } },
      { type: "result", session_id: "scripted-session", result: "Done." },
    ]) stdout.write(JSON.stringify(frame) + "\n");
    stdout.end();
    Object.assign(child, { exitCode: 0 });
    setImmediate(() => { child.emit("exit", 0, null); child.emit("close", 0, null); });
  });
  return child as ChildProcess;
};

let root: string;
afterEach(async () => { await removeTestDir(root); });

it("records a posted worktree turn using defaultRegistryFor's spend recorder", async () => {
  root = mkdtempSync(join(tmpdir(), "sidecar-route-spend-"));
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  const messages: SidecarFramesMessage[] = [];

  async function post(path: string, body: unknown): Promise<{ status: number; body: string }> {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: "POST", url: `/api/sidecar/sessions${path}`, headers: { "content-type": "application/json" },
    }) as IncomingMessage;
    const response = { status: 0, body: "" };
    const res = {
      writeHead(status: number) { response.status = status; },
      end(text: string) { response.body = text; },
    } as ServerResponse;
    expect(await handleSidecarRoute(req, res, ctx, (message) => { messages.push(message as SidecarFramesMessage); })).toBe(true);
    return response;
  }

  const created = await post("", { vendor: "claude", model: "claude-opus-5" });
  expect(created.status).toBe(201);
  const { session } = JSON.parse(created.body) as { session: { id: string; worktree: string } };
  expect(session.worktree).toBe(root);
  expect((await post(`/${session.id}/turns`, { prompt: "Report the fixture usage." })).status).toBe(202);
  await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ sessionId: session.id, running: false, status: "completed" })));

  // Read the actual project ledger, not a spy on the recorder. Removing the
  // production onTurnSpend option leaves no ledger and must fail here.
  const lines = readFileSync(dashboardUsagePath(root), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  expect(lines).toEqual([expect.objectContaining({
    command: "sidecar", vendor: "claude", model: "claude-opus-5",
    inputTokens: 10, outputTokens: 4, calls: 1, outcome: "success",
  })]);
});
