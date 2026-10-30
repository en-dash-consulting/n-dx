/**
 * The credential store across real processes, against the built package.
 *
 * - Two writers in separate processes, each setting its own entries in a
 *   tight loop, lose no update: the cross-process lock serializes their
 *   read-modify-write. Without it the second writer's read predates the
 *   first one's rename and its write drops that entry.
 * - `dist/cli/credentials.js`, the file core spawns, takes the value on stdin
 *   and never prints it.
 *
 * Runs `dist/`; rebuild llm-client after changing its source.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIST = join(import.meta.dirname, "../../dist");
const PUBLIC_URL = pathToFileURL(join(DIST, "public.js")).href;
const CLI = join(DIST, "cli/credentials.js");
const PER_WRITER = 25;

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "ndx-cred-e2e-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A clean environment pointing the ndx home at the temp directory. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NDX_HOME: home, ...extra };
  delete env.TYPESAFE_API_KEY;
  return env;
}

/**
 * Start a writer that loads the module, reports ready, then writes its
 * entries once it reads a line on stdin. The barrier makes the two loops
 * overlap; without it one process's startup can outlast the other's writes.
 */
function startWriter(id: string): { ready: Promise<void>; go: () => void; exit: Promise<number | null> } {
  const script = `
    const { setCredential } = await import(${JSON.stringify(PUBLIC_URL)});
    process.stdout.write("ready\\n");
    process.stdin.once("data", () => {
      for (let i = 0; i < ${PER_WRITER}; i++) {
        setCredential("connection:${id}-" + i, "placeholder-${id}-" + i, { ndxHome: ${JSON.stringify(home)} });
      }
      process.exit(0);
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: childEnv(), stdio: ["pipe", "pipe", "inherit"] });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  const ready = new Promise<void>((resolve) => child.stdout!.once("data", () => resolve()));
  return { ready, exit, go: () => child.stdin!.write("go\n") };
}

describe("credential store across processes", () => {
  it("two concurrent writers lose no update", async () => {
    const writers = [startWriter("a"), startWriter("b")];
    await Promise.all(writers.map((w) => w.ready));
    for (const w of writers) w.go();
    const codes = await Promise.all(writers.map((w) => w.exit));
    expect(codes).toEqual([0, 0]);

    const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf-8"));
    const names = Object.keys(store.entries).sort();
    const expected = ["a", "b"].flatMap((id) => Array.from({ length: PER_WRITER }, (_, i) => `connection:${id}-${i}`)).sort();
    expect(names).toEqual(expected);
  });

  it("the spawnable CLI stores a value from stdin and never prints it", () => {
    const value = "placeholder-spawned-key";
    const set = spawnSync(process.execPath, [CLI, "set", "typesafe"], { env: childEnv(), input: `${value}\n`, encoding: "utf-8" });
    expect(set.status).toBe(0);
    expect(set.stdout + set.stderr).not.toContain(value);

    const status = spawnSync(process.execPath, [CLI, "status", "--json"], { env: childEnv(), encoding: "utf-8" });
    expect(status.status).toBe(0);
    expect(status.stdout).not.toContain(value);
    expect(JSON.parse(status.stdout)[0]).toMatchObject({ name: "typesafe", source: "file", backend: "file" });

    const argv = spawnSync(process.execPath, [CLI, "set", "typesafe", value], { env: childEnv(), input: "", encoding: "utf-8" });
    expect(argv.status).toBe(2);
    expect(argv.stdout + argv.stderr).not.toContain(value);
  });
});
