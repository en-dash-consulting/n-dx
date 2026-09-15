/**
 * What the server *says* about the port it bound.
 *
 * `findAvailablePort` returning the right number is not the whole contract —
 * the server also reports how it got there, twice: a console line for the
 * operator and `StartResult.isFallback` for programmatic callers. Both read a
 * single flag, and for a requested port of 0 both were wrong.
 *
 * Port 0 is the OS convention for "give me any free port". The allocator does
 * exactly that, so nothing fell back — but `isOriginal` is false (the bound
 * port is not the number requested, which is what that flag means), and both
 * consumers treated `!isOriginal` as "your port was taken". The operator saw
 * `Port 0 is in use — using port 54321 instead.`, a statement about a port
 * that was never in use, and a caller that asked for an ephemeral port was
 * told it got a fallback.
 *
 * ## Why an integration test and not a unit test
 *
 * `packages/web/tests/unit/server/port.test.ts` covers the allocator's return
 * shape, and it passed throughout the defect — the numbers were always right.
 * The bug lived in how `start.ts` interpreted them, which only a booted server
 * exercises. A unit test on `findAvailablePort` cannot fail on this.
 *
 * ## Why the occupied-port case is here too
 *
 * Without it this suite passes if the notice is deleted outright. The contrast
 * is the assertion: silent for port 0, still loud for a port that really is
 * taken.
 *
 * @see packages/web/src/server/port.ts — where isFallback is derived
 * @see packages/web/tests/integration/scoped-route-dispatch.test.ts — same driver pattern
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY = join(WEB_PKG, "dist/server/start.js");
// An absolute path is only a legal ESM specifier on POSIX; on Windows `C:\...`
// parses as the scheme `c:`. See the note in scoped-route-dispatch.test.ts.
const SERVER_ENTRY_URL = pathToFileURL(SERVER_ENTRY).href;

/**
 * Boot the real server on `requestedPort`, report what it said, exit.
 *
 * The port file is read here, in the child, rather than by the parent after
 * the child exits: the shutdown handler deletes it on the way out, so a parent
 * read races that cleanup. Reading it while the server is still listening is
 * also when the orchestrator actually reads it.
 */
function driverScript(projectDir: string, requestedPort: number): string {
  return `
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};

const result = await startServer(${JSON.stringify(projectDir)}, ${requestedPort}, {});

let portFile = null;
try {
  portFile = readFileSync(join(${JSON.stringify(projectDir)}, ".n-dx-web.port"), "utf-8").trim();
} catch (err) {
  portFile = "UNREADABLE: " + err.message;
}

console.log("NDX_RESULT=" + JSON.stringify({ ...result, portFile }));
process.exit(0);
`;
}

interface DriverResult {
  stdout: string;
  port: number;
  isFallback: boolean;
  /** Contents of `.n-dx-web.port`, read by the child while the server was up. */
  portFile: string | null;
  exitCode: number;
}

async function boot(projectDir: string, requestedPort: number): Promise<DriverResult> {
  const scriptPath = join(projectDir, "driver.mjs");
  await writeFile(scriptPath, driverScript(projectDir, requestedPort), "utf-8");

  const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>(
    (resolvePromise) => {
      execFile(
        process.execPath,
        [scriptPath],
        { cwd: projectDir, timeout: 60_000 },
        (err, out) => {
          resolvePromise({
            stdout: out ?? "",
            exitCode: err && typeof err.code === "number" ? err.code : 0,
          });
        },
      );
    },
  );

  const match = /NDX_RESULT=(.+)/.exec(stdout);
  const parsed = match
    ? JSON.parse(match[1]) as { port: number; isFallback: boolean; portFile: string | null }
    : null;

  return {
    stdout,
    port: parsed?.port ?? -1,
    isFallback: parsed?.isFallback ?? false,
    portFile: parsed?.portFile ?? null,
    exitCode,
  };
}

/** Bind a port and hold it, so a later request for it genuinely cannot be met. */
async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = createServer();
  const port = await new Promise<number>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePromise(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  return {
    port,
    release: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}

describe("what the server reports about the port it bound", () => {
  // This suite asserts on a behaviour change that shipped in the same commit
  // as the test, so a missing or stale build presents as "the fix doesn't
  // work" — fail as a build problem instead.
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("says nothing about a fallback when port 0 was requested", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ndx-port-zero-"));
    try {
      const result = await boot(dir, 0);

      expect(result.exitCode, `server exited non-zero:\n${result.stdout}`).toBe(0);

      // The defect, at the operator-facing layer.
      expect(
        result.stdout,
        "port 0 was honoured, so there is no fallback to announce",
      ).not.toMatch(/is in use/i);
      expect(result.stdout).not.toContain("Port 0");

      // The same false signal, at the programmatic layer.
      expect(result.isFallback, "StartResult.isFallback for a honoured port-0 request").toBe(false);

      // The fix must not disturb what 33d58b90 got right.
      expect(result.port).toBeGreaterThan(0);
      expect(
        Number(result.portFile),
        `the port file must still carry the real ephemeral port (got ${result.portFile})`,
      ).toBe(result.port);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("still announces the fallback when the requested port really is taken", async () => {
    // The other half. Without this, deleting the notice outright would pass.
    const dir = await mkdtemp(join(tmpdir(), "ndx-port-taken-"));
    const occupied = await occupyPort();
    try {
      const result = await boot(dir, occupied.port);

      expect(result.exitCode, `server exited non-zero:\n${result.stdout}`).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`Port ${occupied.port} is in use`, "i"));
      expect(result.isFallback, "a genuinely occupied port did fall back").toBe(true);
      expect(result.port).not.toBe(occupied.port);
      expect(result.port).toBeGreaterThan(0);
    } finally {
      await occupied.release();
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
