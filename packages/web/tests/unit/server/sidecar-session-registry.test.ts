/**
 * Sidecar session registry: persistence across a restart, the idle TTL,
 * transcripts, and the environment a session's vendor CLI is given.
 *
 * The vendor CLI is a scripted child through the session's `spawn` seam: it
 * reports `session_id` like Claude's stream-json and records each argv and env.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordRepoTrust } from "@n-dx/llm-client";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import {
  DEFAULT_SIDECAR_TTL_MS,
  SidecarSessionRegistry,
  type SidecarSessionConnect,
} from "../../../src/server/sidecar/session-registry.js";
import { resolveSidecarSessionEnv } from "../../../src/server/sidecar/session-env.js";

interface Spawned {
  args: string[];
  env: NodeJS.ProcessEnv | undefined;
}

let root: string;
let dir: string;
let clock: number;
let spawned: Spawned[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-registry-"));
  dir = join(root, ".hench", "sidecar");
  clock = Date.parse("2026-10-26T12:00:00.000Z");
  spawned = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A Claude stand-in: resumes `--resume <id>`, else mints `vendor-<n>`. */
const fakeSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args, opts) => {
  spawned.push({ args, env: opts.env });
  const r = args.indexOf("--resume");
  const id = r >= 0 ? args[r + 1] : `vendor-${spawned.length}`;
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdout = new PassThrough();
  Object.assign(child, { stdin: new PassThrough(), stdout, stderr: new PassThrough(), pid: undefined });
  setImmediate(() => {
    stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: id }) + "\n");
    stdout.write(JSON.stringify({
      type: "assistant",
      session_id: id,
      message: { id: `m-${spawned.length}`, content: [{ type: "text", text: "hello" }], usage: { input_tokens: 10, output_tokens: 4 } },
    }) + "\n");
    stdout.write(JSON.stringify({ type: "result", session_id: id, result: "done" }) + "\n");
    stdout.end();
    setImmediate(() => child.emit("close", 0));
  });
  return child as unknown as ChildProcess;
};

function registry(connect: SidecarSessionConnect = () => ({ spawn: fakeSpawn })): SidecarSessionRegistry {
  return new SidecarSessionRegistry({ dir, connect, now: () => clock });
}

function resumed(call: Spawned): string | undefined {
  const r = call.args.indexOf("--resume");
  return r >= 0 ? call.args[r + 1] : undefined;
}

describe("restart", () => {
  it("resumes the stored vendor id from index.json in a new registry", async () => {
    const first = registry();
    const { id } = first.create({ scope: "worktree", worktree: root, vendor: "claude", name: "Plan" });
    await first.sendTurn(id, "one");
    expect(first.get(id)?.resumeId).toBe("vendor-1");

    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
    expect(index.sessions[0]).toMatchObject({ id, scope: "worktree", worktree: root, name: "Plan", resumeId: "vendor-1", turns: 1 });

    const second = registry();
    const turn = await second.sendTurn(id, "two");
    expect(resumed(spawned[1])).toBe("vendor-1");
    expect(turn.sessionId).toBe("vendor-1");
    expect(second.get(id)).toMatchObject({ turns: 2, tokens: { input: 20, output: 8 } });
  });

  it("reports a turn's spend under the lens it ran with, not one set mid-turn", async () => {
    const spends: Array<{ lens?: string; input: number }> = [];
    const reg = new SidecarSessionRegistry({
      dir, connect: () => ({ spawn: fakeSpawn }), now: () => clock,
      onTurnSpend: ({ record, tokens }) => spends.push({ lens: record.lens, input: tokens.input }),
    });
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude", lens: "plan" });
    const running = reg.sendTurn(id, "one");
    reg.update(id, { lens: "describe" });
    await running;
    await reg.sendTurn(id, "two");
    expect(spends).toEqual([{ lens: "plan", input: 10 }, { lens: "describe", input: 10 }]);
  });

  it("refuses a second turn while one runs", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    const running = reg.sendTurn(id, "one");
    await expect(reg.sendTurn(id, "two")).rejects.toThrow(/already running/);
    await running;
  });

  it("refuses a turn on an ended session and drops its resume id", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    await reg.end(id);
    expect(reg.get(id)?.resumeId).toBeUndefined();
    await expect(reg.sendTurn(id, "two")).rejects.toThrow(/has ended/);
  });
});

describe("idle TTL", () => {
  it("defaults to two hours", () => {
    expect(DEFAULT_SIDECAR_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("keeps the resume id inside the TTL", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    clock += DEFAULT_SIDECAR_TTL_MS - 1;
    await reg.sendTurn(id, "two");
    expect(resumed(spawned[1])).toBe("vendor-1");
  });

  it("reads report no resume id after the TTL and leave index.json untouched", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    clock += DEFAULT_SIDECAR_TTL_MS + 1;
    const before = readFileSync(join(dir, "index.json"));

    expect(reg.list({ worktree: root })[0].resumeId).toBeUndefined();
    expect(reg.get(id)?.resumeId).toBeUndefined();
    expect(readFileSync(join(dir, "index.json")).equals(before)).toBe(true);
  });

  it("starts the next turn fresh after the TTL and persists the forgotten id", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    clock += DEFAULT_SIDECAR_TTL_MS + 1;
    reg.get(id);

    await reg.sendTurn(id, "two");
    expect(resumed(spawned[1])).toBeUndefined();
    expect(reg.get(id)?.resumeId).toBe("vendor-2");
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
    expect(index.sessions[0].resumeId).toBe("vendor-2");
  });

  it("forgets after a restart too", async () => {
    const { id } = registry().create({ scope: "worktree", worktree: root, vendor: "claude" });
    await registry().sendTurn(id, "one");
    clock += DEFAULT_SIDECAR_TTL_MS + 1;
    await registry().sendTurn(id, "two");
    expect(resumed(spawned[1])).toBeUndefined();
  });
});

describe("transcripts", () => {
  it("are JSONL frames in a self-ignoring directory, read back after a cursor", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");

    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe("*\n");
    expect(existsSync(join(dir, `${id}.jsonl`))).toBe(true);

    const frames = reg.readFrames(id);
    expect(frames[0]).toMatchObject({ seq: 1, type: "user", text: "one" });
    expect(frames.slice(1).every((f) => f.type === "event")).toBe(true);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    expect(reg.get(id)?.cursor).toBe(frames.length);

    await registry().sendTurn(id, "two");
    const after = registry().readFrames(id, frames.length);
    expect(after[0]).toMatchObject({ seq: frames.length + 1, type: "user", text: "two" });
  });

  it("continues numbering after frames the index never recorded (server stopped mid-turn)", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    // A turn's event frames reach the transcript before the index: a server
    // that stops mid-turn leaves the index cursor at the user frame.
    const indexPath = join(dir, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    index.sessions[0].cursor = 1;
    writeFileSync(indexPath, JSON.stringify(index));

    const restarted = registry();
    await restarted.sendTurn(id, "two");
    const seqs = restarted.readFrames(id).map((f) => f.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(restarted.get(id)?.cursor).toBe(seqs.length);
  });

  it("reads every complete frame when the transcript ends in a partial line", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    const complete = reg.readFrames(id);
    appendFileSync(join(dir, `${id}.jsonl`), '{"seq":99,"at":"2026');

    expect(registry().readFrames(id)).toEqual(complete);
  });

  it("appends the next turn on its own lines with consecutive seq after a fragment", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    const count = reg.readFrames(id).length;
    const path = join(dir, `${id}.jsonl`);
    appendFileSync(path, '{"seq":99,"at":"2026');

    const restarted = registry();
    await restarted.sendTurn(id, "two");
    const frames = restarted.readFrames(id);
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
    expect(frames[count]).toMatchObject({ type: "user", text: "two" });
    expect(readFileSync(`${path}.corrupt`, "utf-8")).toBe('{"seq":99,"at":"2026\n');
  });

  it("raises an error naming the file for a malformed complete middle line", async () => {
    const reg = registry();
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    const path = join(dir, `${id}.jsonl`);
    const lines = readFileSync(path, "utf-8").split("\n");
    lines.splice(1, 0, "{not json");
    writeFileSync(path, lines.join("\n"));

    expect(() => reg.readFrames(id)).toThrow(path);
  });

  it("filters sessions by scope and worktree", () => {
    const reg = registry();
    reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    reg.create({ scope: "worktree", worktree: "/elsewhere", vendor: "codex" });
    reg.create({ scope: "hub", worktree: root, vendor: "claude" });
    expect(reg.list({ scope: "worktree", worktree: root })).toHaveLength(1);
    expect(reg.list({ scope: "worktree" })).toHaveLength(2);
  });
});

describe("vendor environment", () => {
  const SECRET = "SIDECAR_TEST_TOKEN";

  beforeEach(() => {
    process.env[SECRET] = "secret";
  });
  afterEach(() => {
    delete process.env[SECRET];
  });

  function writeHenchConfig(guardEnv: Record<string, unknown>): void {
    mkdirSync(join(root, ".hench"), { recursive: true });
    writeFileSync(join(root, ".hench", "config.json"), JSON.stringify({ guard: { env: guardEnv } }));
  }

  async function envOfTurn(): Promise<NodeJS.ProcessEnv> {
    const reg = registry((record) => ({ ...resolveSidecarSessionEnv(record.worktree), spawn: fakeSpawn }));
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
    await reg.sendTurn(id, "one");
    const env = spawned[0].env;
    if (!env) throw new Error("the vendor CLI got the full process.env (no env passed)");
    return env;
  }

  it("is the guard-filtered environment, never the full process.env", async () => {
    const env = await envOfTurn();
    expect(env[SECRET]).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("drops a repository guard.env.allow while the checkout is untrusted", async () => {
    writeHenchConfig({ allow: [SECRET] });
    expect(resolveSidecarSessionEnv(root).envPolicy?.allow).toBeUndefined();
    expect((await envOfTurn())[SECRET]).toBeUndefined();
  });

  it("applies guard.env.allow once the checkout is trusted", async () => {
    writeHenchConfig({ allow: [SECRET] });
    recordRepoTrust(root);
    expect((await envOfTurn())[SECRET]).toBe("secret");
  });

  it("merges the .n-dx.json hench override over .hench/config.json", () => {
    writeHenchConfig({ deny: ["FROM_HENCH_*"] });
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ hench: { guard: { env: { deny: ["FROM_NDX_*"] } } } }));
    expect(resolveSidecarSessionEnv(root).envPolicy?.deny).toEqual(["FROM_NDX_*"]);
  });
});
