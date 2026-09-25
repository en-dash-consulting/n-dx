/**
 * A scripted vendor CLI for driving `cliLoop` end to end from JSONL
 * fixtures — Claude stream-json by default, or `codex exec --json` events.
 *
 * Each vendor-CLI spawn consumes the next scripted turn. The turn sees what
 * the real CLI would have received (argv and stdin), may act on the fixture
 * repository the way an agent would (write a file, commit, write a review
 * report), and returns the stream-json lines the session emits.
 *
 * Unlike `cliSpawnsOnly`, everything that is not the vendor CLI — `git`, the
 * test gate's command — is passed through to the real binary rather than
 * answered with an empty child: the behaviour under test here turns on whether
 * the session's work is committed, which only a real repository can answer.
 */

import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { spawn as nodeSpawn } from "node:child_process";
import { serializeDocument } from "@n-dx/rex";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { setupProjectDir, disableMemoryGuard, commitGitFixtureBaseline } from "./index.js";

/** What one vendor-CLI spawn received. */
export interface CliInvocation {
  /**
   * The vendor CLI's own argv, without the binary — the same shape on every
   * platform. On Windows `spawnCli` launches the CLI as
   * `cmd.exe /d /s /c "<quoted command line>"`; that line is decoded back
   * here, so tests assert the argv the CLI actually parses rather than one
   * platform's wrapper.
   */
  args: string[];
  stdin: string;
}

/** A single scripted session: inspect the invocation, act, emit stream-json. */
export type ScriptedTurn = (call: CliInvocation) => { lines: object[]; code?: number };

function commandBase(command: string): string {
  return command.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
}

const VENDOR_CLIS = ["claude", "codex"];

/**
 * Split a command line built by `buildWindowsCliCommandLine` back into its
 * tokens — the binary first, then the argv.
 *
 * The inverse of `quoteWindowsToken`: every argument is wrapped in `"…"`, an
 * embedded quote is written `""`, and backslashes are doubled only where they
 * precede a quote (or the closing quote). The binary may be bare.
 *
 * @internal Exported for testing.
 */
export function decodeWindowsCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && line[i] === " ") i++;
    if (i >= n) break;
    if (line[i] !== '"') {
      const start = i;
      while (i < n && line[i] !== " ") i++;
      tokens.push(line.slice(start, i));
      continue;
    }
    i++; // opening quote
    let token = "";
    while (i < n) {
      let slashes = 0;
      while (i < n && line[i] === "\\") {
        slashes++;
        i++;
      }
      if (i < n && line[i] === '"') {
        token += "\\".repeat(slashes / 2);
        if (line[i + 1] === '"') {
          token += '"'; // `""` is an embedded quote
          i += 2;
          continue;
        }
        i++; // closing quote
        break;
      }
      token += "\\".repeat(slashes);
      if (i < n) token += line[i++];
    }
    tokens.push(token);
  }
  return tokens;
}

/**
 * The vendor binary and argv behind one spawn, or undefined when the spawn is
 * not a vendor CLI. On Windows `spawnCli` runs `cmd.exe /d /s /c "<line>"`,
 * where `<line>` is the quoted command line; it is decoded back to argv.
 */
function vendorInvocation(command: string, args: string[]): { args: string[] } | undefined {
  const base = commandBase(command).toLowerCase();
  if (base === "cmd") {
    const wrapped = args[args.length - 1] ?? "";
    const line = wrapped.startsWith('"') && wrapped.endsWith('"') ? wrapped.slice(1, -1) : wrapped;
    const [binary = "", ...argv] = decodeWindowsCommandLine(line);
    return VENDOR_CLIS.includes(commandBase(binary).toLowerCase()) ? { args: argv } : undefined;
  }
  return VENDOR_CLIS.includes(base) ? { args } : undefined;
}

function emptyChild(): EventEmitter {
  const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(proc, {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: () => true, end: () => {}, on: () => {} },
    kill: () => true,
  });
  queueMicrotask(() => proc.emit("close", 0, null));
  return proc;
}

export interface ScriptedClaudeCli {
  /** Drop-in for `child_process.spawn`. */
  spawn: (command: string, args?: string[], opts?: unknown) => unknown;
  /** Every vendor-CLI spawn made so far, in order. */
  invocations: CliInvocation[];
  /** Queue the next sessions. */
  script: (...turns: ScriptedTurn[]) => void;
}

export function createScriptedClaudeCli(actualSpawn: typeof nodeSpawn): ScriptedClaudeCli {
  const invocations: CliInvocation[] = [];
  const queue: ScriptedTurn[] = [];

  function cliChild(args: string[]): EventEmitter {
    const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let stdin = "";
    let started = false;

    const run = (): void => {
      if (started) return;
      started = true;
      const call: CliInvocation = { args: [...args], stdin };
      invocations.push(call);
      const turn = queue.shift();
      setImmediate(() => {
        if (!turn) {
          stderr.emit("data", Buffer.from(`scripted CLI: unexpected spawn #${invocations.length}`));
          proc.emit("close", 1, null);
          return;
        }
        const { lines, code = 0 } = turn(call);
        const text = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
        stdout.emit("data", Buffer.from(text));
        proc.emit("close", code, null);
      });
    };

    Object.assign(proc, {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      stdout,
      stderr,
      stdin: {
        write: (chunk: unknown) => {
          stdin += String(chunk);
          return true;
        },
        end: run,
        on: () => {},
      },
      kill: () => true,
    });
    return proc;
  }

  return {
    invocations,
    script: (...turns) => queue.push(...turns),
    spawn: (command, args = [], opts) => {
      const vendor = vendorInvocation(command, args);
      if (!vendor) {
        return (actualSpawn as (c: string, a: string[], o: unknown) => unknown)(command, args, opts);
      }
      if (vendor.args.length === 1 && vendor.args[0] === "--version") return emptyChild();
      return cliChild(vendor.args);
    },
  };
}

// ── Stream-json fixture builders ────────────────────────────────────────────

/** The `system`/`init` line that opens every Claude stream-json session. */
export function initLine(sessionId: string): object {
  return { type: "system", subtype: "init", session_id: sessionId };
}

/** An assistant turn that makes one tool call. */
export function toolUseLine(sessionId: string, name: string, input: Record<string, unknown>): object {
  return {
    type: "assistant",
    session_id: sessionId,
    message: {
      content: [{ type: "tool_use", id: `tu-${name}-${Math.random().toString(36).slice(2, 8)}`, name, input }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
}

/** An assistant turn that only speaks. */
export function textLine(sessionId: string, text: string): object {
  return {
    type: "assistant",
    session_id: sessionId,
    message: { content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } },
  };
}

/** The closing `result` line. */
export function resultLine(sessionId: string, text: string, numTurns = 2): object {
  return { type: "result", subtype: "success", session_id: sessionId, result: text, num_turns: numTurns };
}

/** True when this invocation resumes `sessionId`. */
export function resumes(call: CliInvocation, sessionId: string): boolean {
  const at = call.args.indexOf("--resume");
  return at !== -1 && call.args[at + 1] === sessionId;
}

/** True when this invocation forks the session it resumes. */
export function forks(call: CliInvocation): boolean {
  return call.args.includes("--fork-session");
}

// ── Project fixture ─────────────────────────────────────────────────────────

/**
 * A project a scripted `cliLoop` can run to completion in: hench and rex
 * configured, one pending task (`task-1`), the agent committing its own work
 * (`autoCommit`), a trivially passing full test gate, cold sessions, and
 * everything committed as a baseline.
 */
export async function setupScriptedProject(prefix: string): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const dirs = await setupProjectDir(prefix);
  await disableMemoryGuard(dirs.henchDir);
  const config = await loadConfig(dirs.henchDir);
  await saveConfig(dirs.henchDir, {
    ...config,
    autoCommit: true,
    fullTestCommand: "node --version",
    sessionStrategy: "cold",
  });
  await writeFile(
    join(dirs.rexDir, "prd.md"),
    serializeDocument({
      schema: "rex/v1",
      title: "Test",
      items: [{ id: "task-1", title: "Scripted task", status: "pending", level: "task", priority: "high" }],
    } as never),
    "utf-8",
  );
  commitGitFixtureBaseline(dirs.projectDir);
  return dirs;
}
