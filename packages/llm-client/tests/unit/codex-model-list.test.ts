import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { listCodexModels } from "../../src/codex-model-list.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/exec.js", () => ({ spawnCli: mocks.spawn }));
vi.mock("../../src/process-tree.js", () => ({ terminateProcessTree: mocks.stop }));
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
let sent: Array<{ id: number; method: string; params: Record<string, unknown> }>;
const options = { binary: "/selected/codex", cwd: "/workspace", env: { PATH: "/trusted" }, timeoutMs: 100 };
const reply = (id: number, result: unknown) => child.stdout.write(`${JSON.stringify({ id, result })}\n`);
beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.stop.mockReset().mockResolvedValue(undefined);
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  sent = [];
  child.stdin.on("data", (chunk) => sent.push(JSON.parse(String(chunk))));
  mocks.spawn.mockReturnValue(child);
});

describe("Codex client catalog (simulated protocol)", () => {
  it("waits for initialization and follows pagination using model, not display id", async () => {
    const pending = listCodexModels(options);
    expect(sent.map(x => x.method)).toEqual(["initialize"]);
    reply(1, {});
    expect(sent.map(x => x.method)).toEqual(["initialize", "initialized", "model/list"]);
    reply(2, { data: [{ id: "display", model: "gpt-new" }, { model: "gpt-hidden", hidden: true }], nextCursor: "next" });
    expect(sent[3].params.cursor).toBe("next");
    reply(3, { data: [{ model: "gpt-new" }, { model: "gpt-other" }], nextCursor: null });
    expect(await pending).toEqual({ ok: true, models: ["gpt-new", "gpt-other"] });
    expect(mocks.spawn).toHaveBeenCalledWith(options.binary, ["app-server"], { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("times out without claiming access or returning partial models", async () => {
    const pending = listCodexModels({ ...options, timeoutMs: 10 });
    reply(1, {});
    reply(2, { data: [{ model: "gpt-partial" }], nextCursor: "next" });
    expect(await pending).toEqual({ ok: false, reason: expect.stringContaining("timed out") });
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "close", "malformed", "rejected", "empty", "pagination"])("fails honestly on %s", async (kind) => {
    const pending = listCodexModels(options);
    if (kind === "error") child.emit("error", new Error("secret"));
    if (kind === "close") child.emit("close", 1);
    if (kind === "malformed") child.stdout.write("not json secret\n");
    if (kind === "rejected") child.stdout.write('{"id":1,"error":{"message":"secret"}}\n');
    if (kind === "empty") { reply(1, {}); reply(2, { data: [] }); }
    if (kind === "pagination") {
      reply(1, {});
      reply(2, { data: [], nextCursor: "repeat" });
      reply(3, { data: [], nextCursor: "repeat" });
    }
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("handles a synchronous launch failure", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("secret"); });
    expect(await listCodexModels(options)).toEqual({ ok: false, reason: expect.stringContaining("could not start") });
  });
});
