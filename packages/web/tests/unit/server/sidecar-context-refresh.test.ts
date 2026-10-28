/**
 * Sidecar context ceiling: a turn that ends above the ceiling checkpoints,
 * and the next turn starts a cold vendor session from the rebuilt packet, the
 * ledger and the last two exchanges, never the old transcript.
 *
 * The vendor CLI is a scripted child through the session's `spawn` seam. It
 * reads the prompt from stdin like Claude's `-p` mode and records it.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordRepoTrust } from "@n-dx/llm-client";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import {
  CHECKPOINT_PROMPT,
  composeColdPrompt,
  DEFAULT_CONTEXT_CEILINGS,
  resolveContextCeiling,
} from "../../../src/server/sidecar/context-refresh.js";
import {
  appendLedgerEntry,
  LEDGER_RENDER_MAX_CHARS,
  readLedger,
  renderLedger,
  type LedgerEntry,
} from "../../../src/server/sidecar/ledger.js";
import { loadPrdModel } from "../../../src/server/rex-gateway.js";
import { buildLensPacket } from "../../../src/server/sidecar/lens-packets.js";
import type { PacketSources } from "../../../src/server/sidecar/packet-sources.js";
import {
  SidecarSessionRegistry,
  type SidecarFrame,
} from "../../../src/server/sidecar/session-registry.js";

interface Spawn {
  args: string[];
  stdin: string;
}

let root: string;
let dir: string;
let spawns: Spawn[];
/** Context tokens the next vendor call reports. */
let contextSize: number;
let sessionId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-context-"));
  dir = join(root, ".hench", "sidecar");
  spawns = [];
  contextSize = 10;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A Claude stand-in. Its reply to a prompt is `reply to <first line>`; the
 * checkpoint prompt gets a reply of its own and writes two ledger entries.
 */
const fakeSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  const spawn: Spawn = { args, stdin: "" };
  spawns.push(spawn);
  const r = args.indexOf("--resume");
  const id = r >= 0 ? args[r + 1]! : `vendor-${spawns.length}`;
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined });
  stdin.on("data", (chunk: Buffer) => { spawn.stdin += chunk.toString(); });
  stdin.on("end", () => {
    const checkpoint = spawn.stdin === CHECKPOINT_PROMPT;
    if (checkpoint) {
      const at = new Date().toISOString();
      appendLedgerEntry(dir, sessionId, { at, type: "decision", text: "keep the cursor in the index" });
      appendLedgerEntry(dir, sessionId, { at, type: "unfinished", text: "the drawer divider is M2" });
    }
    const reply = checkpoint ? "ckpt-reply-marker" : `reply to ${spawn.stdin.split("\n")[0]}`;
    stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: id }) + "\n");
    stdout.write(JSON.stringify({
      type: "assistant",
      session_id: id,
      message: { id: `m-${spawns.length}`, content: [{ type: "text", text: reply }], usage: { input_tokens: contextSize, output_tokens: 4 } },
    }) + "\n");
    stdout.write(JSON.stringify({ type: "result", session_id: id, result: reply }) + "\n");
    stdout.end();
    setImmediate(() => child.emit("close", 0));
  });
  return child as unknown as ChildProcess;
};

function registry(ceiling = 1000, packet?: string): SidecarSessionRegistry {
  return new SidecarSessionRegistry({
    dir,
    connect: () => ({ spawn: fakeSpawn }),
    context: {
      ceiling: () => ceiling,
      ledger: (record) => readLedger(dir, record.id),
      packet: async () => packet,
    },
  });
}

function open(reg: SidecarSessionRegistry): string {
  recordRepoTrust(root);
  const session = reg.create({ scope: "worktree", worktree: root, vendor: "claude" });
  sessionId = session.id;
  return session.id;
}

async function turn(reg: SidecarSessionRegistry, id: string, prompt: string, context: number): Promise<void> {
  contextSize = context;
  await reg.sendTurn(id, prompt);
}

describe("checkpoint at the ceiling", () => {
  it("does not checkpoint a turn that ends at or below the ceiling", async () => {
    const reg = registry(1000);
    const id = open(reg);
    await turn(reg, id, "small", 1000);
    expect(spawns).toHaveLength(1);
    expect(reg.get(id)?.refresh).toBeUndefined();
  });

  it("runs a ledger turn in the same vendor session and marks the session for a cold start", async () => {
    const reg = registry(1000);
    const id = open(reg);
    await turn(reg, id, "big", 5000);

    expect(spawns).toHaveLength(2);
    expect(spawns[1]!.stdin).toBe(CHECKPOINT_PROMPT);
    expect(spawns[1]!.args).toContain("--resume");
    expect(reg.get(id)?.refresh).toEqual({ contextTokens: 5000, ceiling: 1000 });
    expect(readLedger(dir, id).map((e) => e.type)).toEqual(["decision", "unfinished"]);
    // The ledger turn's events are in the transcript, flagged, so a client can tell them apart.
    const flagged = reg.readFrames(id).filter((f) => f.type === "event" && f.checkpoint);
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("starts the next turn cold from the packet, the ledger and the last two exchanges only", async () => {
    const reg = registry(1000, "## PACKET-MARKER");
    const id = open(reg);
    await turn(reg, id, "oldest-marker", 10);
    await turn(reg, id, "middle question", 10);
    await turn(reg, id, "recent question", 5000); // checkpoints
    const before = spawns.length;
    await turn(reg, id, "after the refresh", 10);

    expect(spawns).toHaveLength(before + 1);
    const cold = spawns[before]!;
    expect(cold.args).not.toContain("--resume");
    expect(cold.stdin).toContain("## PACKET-MARKER");
    expect(cold.stdin).toContain("- [decision] keep the cursor in the index");
    expect(cold.stdin).toContain("- [unfinished] the drawer divider is M2");
    expect(cold.stdin).toContain("middle question");
    expect(cold.stdin).toContain("reply to middle question");
    expect(cold.stdin).toContain("recent question");
    expect(cold.stdin).toContain("reply to recent question");
    expect(cold.stdin).toContain("after the refresh");
    // The old transcript is never re-sent: not the exchange before the last two,
    // and not the ledger turn's own prompt or reply.
    expect(cold.stdin).not.toContain("oldest-marker");
    expect(cold.stdin).not.toContain("reply to oldest-marker");
    expect(cold.stdin).not.toContain("ckpt-reply-marker");
    expect(cold.stdin).not.toContain("Your context is full");
    expect(reg.get(id)?.refresh).toBeUndefined();
  });

  it("starts the cold turn with the notes of a checkpoint that followed a crash mid-append", async () => {
    const reg = registry(1000);
    const id = open(reg);
    // A server killed mid ledger_append left a fragment with no newline.
    mkdirSync(dir, { recursive: true });
    const ledgerFile = join(dir, `${id}.ledger.jsonl`);
    const fragment = '{"at":"2026-10-28T00:00:00.000Z","type":"deci';
    writeFileSync(ledgerFile, fragment);
    await turn(reg, id, "big", 5000); // the checkpoint appends two entries
    await turn(reg, id, "after the crash", 10);

    expect(readLedger(dir, id).map((e) => e.type)).toEqual(["decision", "unfinished"]);
    expect(readFileSync(`${ledgerFile}.corrupt`, "utf-8")).toBe(`${fragment}\n`);
    const cold = spawns.at(-1)!;
    expect(cold.args).not.toContain("--resume");
    expect(cold.stdin).toContain("- [decision] keep the cursor in the index");
    expect(cold.stdin).toContain("- [unfinished] the drawer divider is M2");
  });

  it("records the refresh as a transcript frame with the notes carried", async () => {
    const reg = registry(1000);
    const id = open(reg);
    await turn(reg, id, "big", 5000);
    const frames: SidecarFrame[] = [];
    contextSize = 10;
    await reg.sendTurn(id, "next", (f) => frames.push(f));

    const refreshed = frames.filter((f) => f.type === "context-refreshed");
    expect(refreshed).toEqual([expect.objectContaining({ type: "context-refreshed", notes: 2, contextTokens: 5000 })]);
    // The user frame stays first, so a client fetching from the prompt on sees the divider.
    expect(frames[0]!.type).toBe("user");
    expect(frames[1]!.type).toBe("context-refreshed");
  });

  it("resumes the new vendor session on the turn after the cold one", async () => {
    const reg = registry(1000);
    const id = open(reg);
    await turn(reg, id, "big", 5000);
    await turn(reg, id, "cold", 10);
    await turn(reg, id, "warm", 10);
    expect(spawns.at(-1)!.args).toContain("--resume");
    expect(spawns.at(-1)!.stdin).toBe("warm");
  });

  it("keeps the cold start across a server restart", async () => {
    const first = registry(1000);
    const id = open(first);
    await turn(first, id, "big", 5000);
    const second = registry(1000);
    await turn(second, id, "after restart", 10);
    expect(spawns.at(-1)!.args).not.toContain("--resume");
    expect(spawns.at(-1)!.stdin).toContain("after restart");
  });

  it("honours an interrupt that arrives while the cold turn builds its packet", async () => {
    let release: ((text: string) => void) | undefined;
    let held = false;
    const reg = new SidecarSessionRegistry({
      dir,
      connect: () => ({ spawn: fakeSpawn }),
      context: {
        ceiling: () => 1000,
        ledger: (record) => readLedger(dir, record.id),
        // The first cold build waits for the test; every other build answers at once.
        packet: (record) => (record.refresh && !held && (held = true)
          ? new Promise<string>((resolve) => { release = resolve; })
          : Promise.resolve("## PACKET")),
      },
    });
    const id = open(reg);
    await turn(reg, id, "big", 5000); // checkpoints
    const before = spawns.length;

    const cold = reg.sendTurn(id, "stopped before it began");
    await new Promise((r) => setImmediate(r));
    expect(await reg.interrupt(id)).toBe(true);
    release!("## PACKET");
    const result = await cold;

    expect(result.status).toBe("interrupted");
    expect(spawns).toHaveLength(before);
    expect(reg.isRunning(id)).toBe(false);
    // Still marked, so the next turn starts cold rather than resuming the oversized session.
    expect(reg.get(id)?.refresh).toBeDefined();
    contextSize = 10;
    await reg.sendTurn(id, "again");
    expect(spawns.at(-1)!.args).not.toContain("--resume");
  });

  it("never checkpoints without context options", async () => {
    const reg = new SidecarSessionRegistry({ dir, connect: () => ({ spawn: fakeSpawn }) });
    const id = open(reg);
    await turn(reg, id, "huge", 9_000_000);
    expect(spawns).toHaveLength(1);
  });

  it("refuses a second turn while the first is still preparing or running", async () => {
    const reg = registry(1000);
    const id = open(reg);
    const first = reg.sendTurn(id, "one");
    expect(reg.isRunning(id)).toBe(true);
    await expect(reg.sendTurn(id, "two")).rejects.toThrow(/already running/);
    await first;
    expect(reg.isRunning(id)).toBe(false);
  });
});

describe("ceiling configuration", () => {
  function config(body: unknown, file = ".n-dx.json"): void {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, file), JSON.stringify(body));
  }

  it("defaults to 100k for worktree sessions and 40k for hub sessions", () => {
    expect(resolveContextCeiling(root, "worktree")).toBe(100_000);
    expect(resolveContextCeiling(root, "hub")).toBe(40_000);
    expect(DEFAULT_CONTEXT_CEILINGS).toEqual({ worktree: 100_000, hub: 40_000 });
  });

  it("is set per scope in project config", () => {
    config({ web: { sidecarContextCeiling: { worktree: 150_000 } } });
    expect(resolveContextCeiling(root, "worktree")).toBe(150_000);
    expect(resolveContextCeiling(root, "hub")).toBe(40_000);
  });

  it("ignores a value that is not a positive integer", () => {
    config({ web: { sidecarContextCeiling: { worktree: "lots", hub: -5 } } });
    expect(resolveContextCeiling(root, "worktree")).toBe(100_000);
    expect(resolveContextCeiling(root, "hub")).toBe(40_000);
  });
});

describe("ledger rendering", () => {
  const entry = (text: string): LedgerEntry => ({ at: "2026-10-28T00:00:00.000Z", type: "gotcha", text });

  it("renders every entry that fits", () => {
    const out = renderLedger([entry("a"), entry("b")]);
    expect(out).toEqual({ text: "- [gotcha] a\n- [gotcha] b", carried: 2 });
  });

  it("stays within 3k characters, keeps the newest and says what it left out", () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(`note ${String(i).padStart(2, "0")} ${"x".repeat(200)}`));
    const out = renderLedger(entries);
    expect(out.text.length).toBeLessThanOrEqual(LEDGER_RENDER_MAX_CHARS);
    expect(out.carried).toBeLessThan(40);
    expect(out.text).toContain("note 39");
    expect(out.text).not.toContain("note 00");
    expect(out.text.startsWith(`(${40 - out.carried} older notes left out to fit)`)).toBe(true);
  });

  it("carries nothing from an empty ledger", () => {
    expect(renderLedger([])).toEqual({ text: "", carried: 0 });
  });
});

describe("cold prompt", () => {
  it("says so when no notes were left", () => {
    const text = composeColdPrompt({ ledger: "", exchanges: [], prompt: "go" });
    expect(text).toContain("(no notes were left)");
    expect(text).toContain("## Operator's message\ngo");
    expect(text).not.toContain("exchange");
  });
});

describe("the packet opens the first turn", () => {
  it("sends the packet with turn one only, in front of the operator's message", async () => {
    const reg = registry(1000, "## PACKET-MARKER");
    const id = open(reg);
    await turn(reg, id, "first question", 10);
    await turn(reg, id, "second question", 10);

    expect(spawns[0]!.stdin).toContain("## PACKET-MARKER");
    expect(spawns[0]!.stdin.indexOf("## PACKET-MARKER")).toBeLessThan(spawns[0]!.stdin.indexOf("first question"));
    expect(spawns[1]!.stdin).toBe("second question");
  });

  it("sends nothing extra when the lens has no packet", async () => {
    const reg = registry(1000);
    const id = open(reg);
    await turn(reg, id, "first question", 10);
    expect(spawns[0]!.stdin).toBe("first question");
  });

  it("carries the new packet on the next turn after a re-lens or a new target, once", async () => {
    const reg = new SidecarSessionRegistry({
      dir,
      connect: () => ({ spawn: fakeSpawn }),
      context: {
        ceiling: () => 1000,
        ledger: () => [],
        packet: async (record) => `## PACKET ${record.lens} ${record.target?.ref ?? "-"}`,
      },
    });
    recordRepoTrust(root);
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude", lens: "explain" });
    await reg.sendTurn(id, "one");
    await reg.sendTurn(id, "two");
    reg.update(id, { name: "Renamed" });
    await reg.sendTurn(id, "three");
    reg.update(id, { lens: "describe", target: { ref: "T-1" } });
    await reg.sendTurn(id, "four");
    await reg.sendTurn(id, "five");

    expect(spawns.map((s) => s.stdin.split("\n")[0])).toEqual([
      "## PACKET explain -", "two", "three", "## PACKET describe T-1", "five",
    ]);
    expect(reg.get(id)).toMatchObject({ name: "Renamed", lens: "describe", target: { ref: "T-1" } });
    expect(reg.get(id)?.packetDue).toBeUndefined();
  });

  it("sends the task packet on turn one of a Describe session on that task", async () => {
    const rexDir = join(root, ".rex");
    mkdirSync(rexDir, { recursive: true });
    cpSync(resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree"), rexDir, { recursive: true });
    const model = await loadPrdModel(rexDir);
    const sources: PacketSources = {
      sourcePaths: { zones: ".sourcevision/zones.json", runs: ".hench/runs/" },
      prd: async () => ({ layout: model.layout, tree: model.tree }),
      evidence: async () => null,
      zones: async () => null,
      resolve: async () => null,
      preview: async () => null,
      runs: async () => [],
    };
    const task = "c0000000-0000-4000-8000-000000000002";
    const reg = new SidecarSessionRegistry({
      dir,
      connect: () => ({ spawn: fakeSpawn }),
      context: {
        ceiling: () => 1000,
        ledger: () => [],
        packet: async (record) => {
          const built = await buildLensPacket(record.lens ?? "general", record.target ?? {}, sources, "2026-10-28T12:00:00.000Z");
          return built.status === "ready" ? built.packet.text : undefined;
        },
      },
    });
    recordRepoTrust(root);
    const { id } = reg.create({ scope: "worktree", worktree: root, vendor: "claude", lens: "describe", target: { ref: task } });
    await reg.sendTurn(id, "what is this?");

    expect(spawns[0]!.stdin).toContain(`# Sidecar context packet: describe · ${task}`);
    expect(spawns[0]!.stdin).toContain("what is this?");
  });
});
