/**
 * A route whose package is out of scope must not run at all.
 *
 * ## Why this test exists, and why it spawns a child process
 *
 * `handleApiRoutes` in `start.ts` gates most routes with
 * `handleScopedRoute(enabled, handler(req, res, ctx))`. That second argument is
 * a value, so the handler is invoked *before* the guard is read. When the guard
 * is false the promise is neither awaited nor cancelled: the handler runs on,
 * the dispatcher falls through to the 404, and the handler's later write throws
 * `ERR_HTTP_HEADERS_SENT` from inside an unawaited promise — an unhandled
 * rejection, which terminates the process on Node 22.
 *
 * The ask route is where that became load-bearing rather than theoretical: it
 * is the only route that reaches an LLM, so running it past its guard spends
 * money before deciding it should not have been called.
 *
 * Two properties have to be checked, and neither survives an in-process test:
 *
 *  1. **The process stays alive.** That is an exit code, not a response status.
 *     Asserting it in-process would mean asserting that the test runner did not
 *     die, which it cannot do after it has died.
 *  2. **The real dispatcher runs.** The existing 16 cases in
 *     `tests/unit/server/routes-sourcevision-ask.test.ts` mount the handler
 *     directly through `startRouteTestServer`, so `start.ts` is never on the
 *     path — which is exactly why they all passed while this was broken.
 *
 * `startServer` also returns only `{ port, isFallback }`, with no handle for
 * closing the server or its watchers, heartbeat monitors and WS intervals. A
 * vitest worker that called it would leak all of them into every later file.
 * A child process is the teardown.
 *
 * ## The crash is the evidence, not the status code
 *
 * The client always receives 404 here — the dispatcher's fall-through wins the
 * race whether or not the handler is also running. So the status cannot
 * distinguish the two states, and an earlier draft of this file asserted only
 * that and passed against the bug.
 *
 * What separates them is whether the handler executed far enough to write:
 * broken, it writes to a finished response and the process dies; fixed, it
 * never runs and the child exits cleanly. The fixture therefore has **no**
 * `.sourcevision/` directory, so the handler's first step fails immediately
 * with `NoAnalysisError` and takes the fast path to `errorResponse` — the write
 * lands within milliseconds of the 404. An earlier draft included `CONTEXT.md`
 * to rule out that branch, which instead sent the handler into a model call
 * that outlived the child and hid the crash. Do not add analysis fixtures here.
 *
 * The in-scope case relies on the same fast path in the opposite direction: a
 * 409 proves the route was dispatched and owned the response, with no model
 * call and no waiting.
 *
 * @see packages/web/src/server/start.ts — the dispatcher under test
 * @see packages/web/tests/unit/server/routes-sourcevision-ask.test.ts — handler-level cases
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY = join(WEB_PKG, "dist/server/start.js");

/**
 * Boot the real server in a child process, POST once, report, exit.
 *
 * Written to a file rather than passed via `-e` so a syntax error points at a
 * line. The child exits 0 on a clean run; an unhandled rejection makes Node
 * exit non-zero on its own, which is the assertion that matters most here.
 */
function driverScript(projectDir: string, scope: string, routePath: string): string {
  return `
import { startServer } from ${JSON.stringify(SERVER_ENTRY)};

const { port } = await startServer(${JSON.stringify(projectDir)}, 0, {
  scope: ${JSON.stringify(scope)},
});

const res = await fetch(\`http://127.0.0.1:\${port}${routePath}\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: "what does the api zone do" }),
});

console.log("NDX_STATUS=" + res.status);

// Let any stray floating promise reject before we exit cleanly, so a crash
// cannot hide behind a fast exit. The handler's failure path is synchronous
// after one failed readFile, so this is generous.
await new Promise((r) => setTimeout(r, 1000));
console.log("NDX_SURVIVED=1");
process.exit(0);
`;
}

interface DriverResult {
  status: number | null;
  survived: boolean;
  exitCode: number;
  stderr: string;
}

async function runDriver(scope: string, routePath: string): Promise<DriverResult> {
  // Deliberately no .sourcevision/ — see the header note on why analysis
  // fixtures hide the defect this file exists to catch.
  const dir = await mkdtemp(join(tmpdir(), "ndx-scope-dispatch-"));
  try {
    const scriptPath = join(dir, "driver.mjs");
    await writeFile(scriptPath, driverScript(dir, scope, routePath), "utf-8");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      const out = await execFileAsync(process.execPath, [scriptPath], {
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }

    const match = /NDX_STATUS=(\d+)/.exec(stdout);
    return {
      status: match ? Number(match[1]) : null,
      survived: stdout.includes("NDX_SURVIVED=1"),
      exitCode,
      stderr,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("scoped route dispatch", () => {
  beforeAll(() => {
    if (!existsSync(SERVER_ENTRY)) {
      expect.fail(
        [
          `Missing build output: ${SERVER_ENTRY}`,
          "This test boots the real server in a child process, so it needs the",
          "compiled server. Run 'pnpm --filter @n-dx/web build' first.",
        ].join("\n"),
      );
    }
  });

  it("does not run the ask route when sourcevision is out of scope", async () => {
    const result = await runDriver("rex", "/api/sourcevision/ask");

    // The handler only reaches a write if it executed past its scope guard.
    expect(
      result.stderr,
      "The out-of-scope ask handler ran anyway and wrote to a response the " +
        "dispatcher's 404 had already finished. The scope check must happen " +
        "before the handler is invoked, not after.",
    ).not.toMatch(/ERR_HTTP_HEADERS_SENT/);
    expect(result.stderr).not.toMatch(/unhandledRejection|UnhandledPromiseRejection/);
  }, 90_000);

  it("survives that request instead of dying on an unhandled rejection", async () => {
    const result = await runDriver("rex", "/api/sourcevision/ask");

    expect(result.survived, "child did not reach its clean-exit marker").toBe(true);
    expect(result.exitCode, "server process died handling one POST").toBe(0);
  }, 90_000);

  it("answers the out-of-scope POST with the dispatcher's 404", async () => {
    const result = await runDriver("rex", "/api/sourcevision/ask");

    expect(result.status).toBe(404);
  }, 90_000);

  it("still dispatches the ask route when sourcevision IS in scope", async () => {
    // The guard must not over-block. 409 is the route declining to answer
    // because the fixture has no analysis — which means it was reached and
    // owned the response, rather than falling through to the 404.
    const result = await runDriver("sourcevision", "/api/sourcevision/ask");

    expect(
      result.status,
      "In-scope POST fell through to the 404, so the route was not dispatched.",
    ).toBe(409);
    expect(result.exitCode).toBe(0);
  }, 90_000);
});
