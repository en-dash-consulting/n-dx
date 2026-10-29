/**
 * Resumable vendor sessions against a scripted stand-in for each CLI.
 *
 * The fakes behave like the real CLIs where the session API depends on them:
 * Claude stamps `session_id` on its lines, honours `--resume <id>` and mints a
 * new id for `--fork-session`; Codex announces `thread.started` and continues
 * a thread with `exec resume <id>`. Every invocation's argv and stdin is logged
 * so the tests can assert what each turn actually sent.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeCli } from "../helpers/fake-cli.js";
import {
  resumeVendorSession,
  startVendorSession,
} from "../../src/vendor-session.js";
import type { RuntimeEvent } from "../../src/runtime-contract.js";

function fakeScript(vendor: "claude" | "codex", log: string): string {
  return `
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin }) + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const prompt = stdin.split("\\n").pop();
const turnNo = Number(process.env.FAKE_TURN ?? "0");

if (${JSON.stringify(vendor)} === "claude") {
  const r = argv.indexOf("--resume");
  const resumed = r >= 0 ? argv[r + 1] : undefined;
  const id = resumed ? (argv.includes("--fork-session") ? "fork-of-" + resumed : resumed) : "claude-1";
  out({ type: "system", subtype: "init", session_id: id });
  if (prompt.includes("STUBBORN")) process.on("SIGTERM", () => {});
  if (prompt.includes("LONG")) {
    out({ type: "assistant", session_id: id, message: "a".repeat(2000) });
    out({ type: "result", session_id: id, result: "r".repeat(2000) });
  } else if (prompt.includes("HANG")) {
    out({ type: "assistant", session_id: id, message: { content: [{ type: "text", text: "working" }] } });
    setInterval(() => {}, 1000);
  } else {
    const message = { id: "msg-" + Math.random(), content: [{ type: "text", text: "echo " + prompt }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 } };
    // Claude repeats a message, usage included, once per content block.
    out({ type: "assistant", session_id: id, message });
    out({ type: "assistant", session_id: id, message });
    if (prompt.includes("FAIL")) {
      out({ type: "result", session_id: id, is_error: true, result: "boom", usage: { input_tokens: 10, output_tokens: 5 } });
      process.exit(1);
    }
    out({ type: "result", session_id: id, result: "done " + prompt, usage: { input_tokens: 10, output_tokens: 5 } });
  }
} else {
  const id = argv[1] === "resume" ? argv[2] : "thread-1";
  out({ type: "thread.started", thread_id: id });
  if (prompt.includes("LONG")) {
    out({ type: "item.completed", item: { type: "agent_message", text: "a".repeat(2000) } });
  } else if (prompt.includes("HANG")) {
    out({ type: "item.completed", item: { type: "agent_message", text: "working" } });
    setInterval(() => {}, 1000);
  } else {
    out({ type: "item.completed", item: { type: "agent_message", text: "echo " + prompt } });
    out({ type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 7 } });
  }
}
`;
}

let dir: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vendor-session-"));
  log = join(dir, "calls.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function calls(): Array<{ argv: string[]; stdin: string }> {
  return readFileSync(log, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
}

function fake(vendor: "claude" | "codex"): string {
  return writeFakeCli(dir, { name: vendor, script: fakeScript(vendor, log) });
}

/** A turn the fake never finishes; `working` resolves once it has started. */
function startHanging(vendor: "claude" | "codex", prompt = "HANG") {
  let markWorking!: () => void;
  const working = new Promise<void>((resolve) => { markWorking = resolve; });
  const session = startVendorSession({
    vendor,
    cwd: dir,
    binary: fake(vendor),
    onEvent: (e) => { if (e.text === "working") markWorking(); },
  });
  return { session, pending: session.sendTurn(prompt), working };
}

describe("claude sessions", () => {
  it("starts, then resumes its own id on the next turn", async () => {
    const events: RuntimeEvent[] = [];
    const session = startVendorSession({
      vendor: "claude",
      cwd: dir,
      binary: fake("claude"),
      systemPrompt: "be brief",
      model: "claude-test",
      onEvent: (e) => events.push(e),
    });
    expect(session.sessionId).toBeUndefined();

    const first = await session.sendTurn("hello");
    expect(first).toMatchObject({ turn: 1, status: "completed", sessionId: "claude-1", text: "done hello" });
    // The repeated message is counted once; the result total stands in for nothing.
    expect(first.tokenUsage).toEqual({ input: 10, output: 5, cacheReadInput: 3 });
    expect(first.events.filter((e) => e.type === "token_usage")).toHaveLength(1);
    expect(events).toEqual(first.events);

    const second = await session.sendTurn("again");
    expect(second).toMatchObject({ turn: 2, status: "completed", sessionId: "claude-1" });
    expect(second.events.every((e) => e.turn === 2)).toBe(true);

    const [a, b] = calls();
    expect(a.argv).not.toContain("--resume");
    if (process.platform === "win32") {
      // cmd.exe cannot carry a multi-line argument, so the system prompt rides stdin.
      expect(a.argv).not.toContain("--system-prompt");
      expect(a.stdin.startsWith("be brief")).toBe(true);
      expect(a.argv).toEqual(expect.arrayContaining(["--model", "claude-test"]));
    } else {
      expect(a.argv).toEqual(expect.arrayContaining(["--system-prompt", "be brief", "--model", "claude-test"]));
    }
    expect(b.argv.slice(-2)).toEqual(["--resume", "claude-1"]);
    expect(session.turns).toBe(2);
  });

  it("resumes a stored id after a restart", async () => {
    const session = resumeVendorSession("stored-7", { vendor: "claude", cwd: dir, binary: fake("claude") });
    expect(session.sessionId).toBe("stored-7");
    const turn = await session.sendTurn("back");
    expect(turn.sessionId).toBe("stored-7");
    expect(calls()[0].argv.slice(-2)).toEqual(["--resume", "stored-7"]);
  });

  it("forks once, then continues the fork", async () => {
    const session = resumeVendorSession("parent", { vendor: "claude", cwd: dir, binary: fake("claude"), fork: true });
    expect((await session.sendTurn("one")).sessionId).toBe("fork-of-parent");
    await session.sendTurn("two");
    const [a, b] = calls();
    expect(a.argv.slice(-3)).toEqual(["--resume", "parent", "--fork-session"]);
    expect(b.argv.slice(-2)).toEqual(["--resume", "fork-of-parent"]);
  });

  it("reports a failed turn and stays usable", async () => {
    const session = startVendorSession({ vendor: "claude", cwd: dir, binary: fake("claude") });
    const failed = await session.sendTurn("FAIL");
    expect(failed).toMatchObject({ status: "failed", error: "boom", exitCode: 1, sessionId: "claude-1" });
    expect(session.state).toBe("idle");
    expect((await session.sendTurn("ok")).status).toBe("completed");
  });

  it("interrupts a running turn and keeps the session", async () => {
    const { session, pending, working } = startHanging("claude");
    expect(session.state).toBe("running");
    await expect(session.sendTurn("second")).rejects.toThrow(/already running/);
    await working;
    await session.interrupt();
    const turn = await pending;
    expect(turn.status).toBe("interrupted");
    expect(turn.sessionId).toBe("claude-1");
    expect(session.state).toBe("idle");
  });

  it("stops a CLI that ignores SIGTERM within 2 s of an interrupt", async () => {
    const { session, pending, working } = startHanging("claude", "STUBBORN HANG");
    await working;
    const started = Date.now();
    await session.interrupt();
    expect((await pending).status).toBe("interrupted");
    // 2 s is the requirement itself, so it is not scaled. Measured 2026-10-26:
    // whole test ~0.7 s with the 500 ms INTERRUPT_GRACE_MS; with the 5 s
    // background default instead it ran past 5 s. Listed in
    // tests/wall-clock-assertion-inventory.md.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("carries the whole reply in assistant and completion events and the turn text", async () => {
    const session = startVendorSession({ vendor: "claude", cwd: dir, binary: fake("claude") });
    const turn = await session.sendTurn("LONG");
    expect(turn.events.find((e) => e.type === "assistant")?.text).toBe("a".repeat(2000));
    expect(turn.events.find((e) => e.type === "completion")?.completionSummary).toBe("r".repeat(2000));
    expect(turn.text).toBe("r".repeat(2000));
  });

  it("refuses turns after end", async () => {
    const { session, pending, working } = startHanging("claude");
    await working;
    await session.end();
    expect((await pending).status).toBe("interrupted");
    expect(session.state).toBe("ended");
    await expect(session.sendTurn("more")).rejects.toThrow(/ended/);
    await session.end();
  });

  it("reports a missing binary as a failed turn", async () => {
    const session = startVendorSession({ vendor: "claude", cwd: dir, binary: join(dir, "missing-claude") });
    const turn = await session.sendTurn("hi");
    expect(turn.status).toBe("failed");
    expect(turn.error).toBeTruthy();
  });
});

describe("codex sessions", () => {
  it("starts a thread, then continues it with exec resume", async () => {
    const session = startVendorSession({
      vendor: "codex",
      cwd: dir,
      binary: fake("codex"),
      systemPrompt: "sys",
      codex: { policyFlags: ["-s", "read-only"] },
    });
    const first = await session.sendTurn("hello");
    expect(first).toMatchObject({ status: "completed", sessionId: "thread-1", text: "echo hello" });
    expect(first.tokenUsage).toEqual({ input: 15, output: 7, cacheReadInput: 5 });

    const second = await session.sendTurn("again");
    expect(second.sessionId).toBe("thread-1");

    const [a, b] = calls();
    expect(a.argv).toEqual(["exec", "-s", "read-only", "--json", "--skip-git-repo-check", "-"]);
    expect(a.stdin).toBe("SYSTEM:\nsys\n\nTASK:\nhello");
    expect(b.argv).toEqual(["exec", "resume", "thread-1", "--json", "--skip-git-repo-check", "-"]);
  });

  it("resumes a stored thread and refuses to fork", async () => {
    expect(() => resumeVendorSession("t", { vendor: "codex", cwd: dir, fork: true })).toThrow(/cannot fork/);
    const session = resumeVendorSession("thread-9", { vendor: "codex", cwd: dir, binary: fake("codex") });
    expect((await session.sendTurn("x")).sessionId).toBe("thread-9");
  });

  it("interrupts a running turn", async () => {
    const { session, pending, working } = startHanging("codex");
    await working;
    await session.interrupt();
    expect((await pending).status).toBe("interrupted");
  });

  it("carries the whole agent message", async () => {
    const session = startVendorSession({ vendor: "codex", cwd: dir, binary: fake("codex") });
    const turn = await session.sendTurn("LONG");
    expect(turn.text).toBe("a".repeat(2000));
  });
});

describe("output decoding", () => {
  it("keeps a multi-byte character that a pipe chunk boundary splits", async () => {
    const line = Buffer.from(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "café ✓" } }) + "\n",
      "utf-8",
    );
    const cut = line.indexOf(Buffer.from("é")) + 1; // between the two bytes of é
    const session = startVendorSession({
      vendor: "codex",
      cwd: dir,
      spawn: () => {
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        const stdout = new PassThrough();
        Object.assign(child, { stdin: new PassThrough(), stdout, stderr: new PassThrough(), pid: undefined });
        setImmediate(() => {
          stdout.write(line.subarray(0, cut));
          stdout.write(line.subarray(cut));
          stdout.end();
          setImmediate(() => child.emit("close", 0));
        });
        return child as unknown as ChildProcess;
      },
    });
    const turn = await session.sendTurn("hi");
    expect(turn.text).toBe("café ✓");
  });
});

describe("child environment", () => {
  const SECRET = "VENDOR_SESSION_TEST_TOKEN";

  /** Run one turn and return the env the spawn received. */
  async function spawnedEnv(opts: Partial<Parameters<typeof startVendorSession>[0]>): Promise<NodeJS.ProcessEnv> {
    let env: NodeJS.ProcessEnv | undefined;
    const session = startVendorSession({
      vendor: "claude",
      cwd: dir,
      ...opts,
      spawn: (_binary, _args, spawnOpts) => {
        env = spawnOpts.env;
        const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
        const stdout = new PassThrough();
        Object.assign(child, { stdin: new PassThrough(), stdout, stderr: new PassThrough(), pid: undefined });
        setImmediate(() => {
          stdout.end();
          setImmediate(() => child.emit("close", 0));
        });
        return child as unknown as ChildProcess;
      },
    });
    await session.sendTurn("hi");
    if (!env) throw new Error("spawn received no env");
    return env;
  }

  beforeEach(() => {
    process.env[SECRET] = "do-not-pass";
  });
  afterEach(() => {
    delete process.env[SECRET];
  });

  it("filters the parent environment when no env is given", async () => {
    const env = await spawnedEnv({});
    expect(env[SECRET]).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("applies the guard.env policy it is given", async () => {
    const env = await spawnedEnv({ envPolicy: { allow: [SECRET] } });
    expect(env[SECRET]).toBe("do-not-pass");
  });

  it("injects a configured API key", async () => {
    const env = await spawnedEnv({ llmConfig: { claude: { api_key: "configured" } } });
    expect(env.ANTHROPIC_API_KEY).toBe("configured");
  });

  it("passes an explicit env through unchanged", async () => {
    const explicit = { ONLY: "this" };
    expect(await spawnedEnv({ env: explicit })).toBe(explicit);
  });
});

describe("unsupported vendors", () => {
  it("have no resumable CLI session", () => {
    expect(() => startVendorSession({ vendor: "openai", cwd: "." })).toThrow(/No resumable CLI session/);
  });
});
