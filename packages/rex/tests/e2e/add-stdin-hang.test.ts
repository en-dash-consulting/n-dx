/**
 * `rex add` in manual mode must not wait on stdin.
 *
 * `dispatchAdd` awaited `readStdin()` before deciding which mode it was in, so
 * every invocation paid for the piped-description form. `readStdin` guards on
 * `process.stdin.isTTY`, which covers a terminal, and a redirect from
 * `/dev/null` reaches EOF immediately — so the bug is invisible interactively
 * and in most scripts. It bites the one caller that matters most: anything
 * spawning the CLI with `stdio: "pipe"` and no intention of writing. The pipe
 * never closes, `end` never fires, and the command hangs forever with no
 * output. Observed: a `rex add task --title=... --description=...` ran past a
 * 120s timeout and had to be killed; the identical command with `< /dev/null`
 * returned at once.
 *
 * Manual mode is identified entirely by argv (a level and/or `--title`), so it
 * has no reason to consult stdin at all.
 *
 * These tests deliberately leave the stdin pipe open — never calling
 * `stdin.end()` — because closing it is exactly what masks the defect.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "../../dist/cli/index.js");

/** Generous enough for a cold Node start on a loaded machine, far under a hang. */
const EXIT_BUDGET_MS = 25_000;

interface RunOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn the rex CLI with an open stdin pipe that is never closed.
 * `write` optionally sends data first, still without closing.
 */
function runWithOpenStdin(args: string[], write?: string): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    if (write !== undefined) child.stdin.write(write);
    // Intentionally no child.stdin.end().

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ status: null, stdout, stderr, timedOut: true });
    }, EXIT_BUDGET_MS);

    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut: false });
    });
  });
}

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "rex-add-stdin-"));
  const rexDir = join(projectDir, ".rex");
  await mkdir(join(rexDir, "prd_tree"), { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ version: "1.0" }), "utf-8");
  await writeFile(join(rexDir, "tree-meta.json"), JSON.stringify({ title: "Stdin PRD" }), "utf-8");
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("rex add with an open stdin pipe", () => {
  it("completes manual mode with a positional level and --title", async () => {
    const outcome = await runWithOpenStdin([
      "add", "epic", "--title=Open pipe positional level", projectDir,
    ]);

    expect(
      outcome.timedOut,
      `rex add did not exit within ${EXIT_BUDGET_MS}ms with stdin held open — ` +
        `manual mode is still waiting on stdin.\nstdout: ${outcome.stdout}\nstderr: ${outcome.stderr}`,
    ).toBe(false);
    expect(outcome.status).toBe(0);
  });

  it("completes manual mode with --level instead of a positional", async () => {
    const outcome = await runWithOpenStdin([
      "add", "--level=epic", "--title=Open pipe level flag", projectDir,
    ]);

    expect(outcome.timedOut, "the --level form still waits on stdin").toBe(false);
    expect(outcome.status).toBe(0);
  });

  it("completes manual mode with --title alone", async () => {
    const outcome = await runWithOpenStdin(["add", "--title=Open pipe title only", projectDir]);

    expect(outcome.timedOut, "the --title-only form still waits on stdin").toBe(false);
    expect(outcome.status).toBe(0);
  });

  it("still fails fast, not hangs, when manual mode is given a bad level", async () => {
    // An argv error must surface as an error, never as a silent wait.
    const outcome = await runWithOpenStdin(["add", "--level=notalevel", projectDir]);

    expect(outcome.timedOut, "an invalid --level hangs instead of erroring").toBe(false);
    expect(outcome.status).not.toBe(0);
  });

  it("says why it is waiting when smart mode legitimately needs the pipe", async () => {
    // Bare `rex add` with an open pipe is the documented
    // `echo "desc" | rex add` contract, so waiting is correct — the producer
    // may simply be slow, and cutting the read short would discard its input.
    // What must not happen is waiting in silence. An earlier attempt at this
    // task bounded the read instead and silently dropped a payload whose first
    // byte arrived after the deadline; the notice is the fix that keeps the
    // wait legible without losing data.
    const outcome = await runWithOpenStdin(["add", projectDir]);

    expect(outcome.timedOut, "expected it to keep waiting for the pipe").toBe(true);
    expect(
      outcome.stderr,
      "waiting on stdin must be announced, not silent",
    ).toMatch(/waiting for piped input on stdin/i);
  });

  it("accepts input that only starts arriving after the notice", async () => {
    // Guards the regression an earlier attempt introduced: bounding the read
    // dropped a payload whose first byte arrived after the deadline.
    //
    // Driven through `parse-md --stdin=true` rather than smart-add: it is the
    // other consumer of the same readStdin, and it parses locally. Routing this
    // through `rex add` would put a live LLM call in the suite.
    const payload = "# Not front-matter\n" + "filler line\n".repeat(2000);

    const outcome = await new Promise<RunOutcome>((resolve) => {
      const child = spawn("node", [CLI, "parse-md", "--stdin=true"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      // First byte well after the silence notice fires.
      setTimeout(() => { child.stdin.write(payload); child.stdin.end(); }, 3_000);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ status: null, stdout, stderr, timedOut: true });
      }, EXIT_BUDGET_MS);
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr, timedOut: false });
      });
    });

    expect(outcome.timedOut).toBe(false);
    const output = `${outcome.stdout}${outcome.stderr}`;
    // "no input was piped" is what dropping the payload looked like. Reaching a
    // complaint about the *content* proves all 24KB arrived.
    expect(output, "late piped input was dropped instead of read").not.toMatch(
      /no input was piped/i,
    );
    expect(output).toMatch(/front-matter/i);
  });
});
