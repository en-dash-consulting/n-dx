/**
 * The viewer's first `/data` request decides whether it loads from a server,
 * offers file drop, or reports a server that would not serve it.
 *
 * The regression this guards: a one-shot `fetch("/data")` treated the hub's
 * 503 ("no running server", answered while `ndx start` was still bringing
 * the project up) the same as a `file://` open, and locked the tab into
 * "Drop .sourcevision files" for a repository whose analysis was on disk.
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyProbeStatus,
  probeServer,
  SERVER_PROBE_DELAYS_MS,
} from "../../../src/viewer/loader/data-loader.js";
import { serverUnavailableCopy } from "../../../src/viewer/components/server-unavailable.js";

function response(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

/** A fetch that answers from a script, one entry per call; a thrown Error entry rejects. */
function scriptedFetch(script: Array<Response | Error>) {
  let calls = 0;
  const fetchFn = vi.fn(async () => {
    const next = script[Math.min(calls, script.length - 1)]!;
    calls++;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchFn, callCount: () => calls };
}

const noSleep = async () => {};

describe("classifyProbeStatus", () => {
  it("a 2xx is a server", () => {
    expect(classifyProbeStatus(200)).toEqual({ result: { mode: "server" }, retry: false });
  });

  it("a 404 is a static host with nothing at /data — the only answer that means file drop", () => {
    expect(classifyProbeStatus(404)).toEqual({ result: { mode: "static" }, retry: false });
  });

  it.each([401, 403, 409, 421])("a %i is a refusal that retrying will not change", (status) => {
    expect(classifyProbeStatus(status)).toEqual({
      result: { mode: "unavailable", status, detail: null },
      retry: false,
    });
  });

  it.each([502, 503, 504, 500])("a %i is worth asking again — the project server may still be starting", (status) => {
    expect(classifyProbeStatus(status)).toEqual({
      result: { mode: "unavailable", status, detail: null },
      retry: true,
    });
  });
});

describe("probeServer", () => {
  it("answers server on the first 200 without sleeping", async () => {
    const { fetchFn, callCount } = scriptedFetch([response(200, { files: [] })]);
    const sleep = vi.fn(noSleep);
    expect(await probeServer({ fetchFn, sleep })).toEqual({ mode: "server" });
    expect(callCount()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps asking through the hub's startup 503s and enters server mode when the child answers", async () => {
    const { fetchFn, callCount } = scriptedFetch([
      response(503, { error: 'Project "n-dx" has no running server', status: "starting" }),
      response(503, { error: 'Project "n-dx" has no running server', status: "starting" }),
      response(200, { files: ["manifest.json"] }),
    ]);
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); };
    expect(await probeServer({ fetchFn, sleep })).toEqual({ mode: "server" });
    expect(callCount()).toBe(3);
    expect(slept).toEqual(SERVER_PROBE_DELAYS_MS.slice(0, 2));
  });

  it("gives up after the retry budget and reports the hub's own words", async () => {
    const { fetchFn, callCount } = scriptedFetch([
      response(503, { error: 'Project "n-dx" has no running server' }),
    ]);
    const probe = await probeServer({ fetchFn, sleep: noSleep });
    expect(probe).toEqual({ mode: "unavailable", status: 503, detail: 'Project "n-dx" has no running server' });
    expect(callCount()).toBe(SERVER_PROBE_DELAYS_MS.length + 1);
  });

  it("does not retry a 401, and carries the server's hint", async () => {
    const { fetchFn, callCount } = scriptedFetch([
      response(401, { error: "Authentication required", hint: "Open the URL printed by `ndx start`." }),
    ]);
    const sleep = vi.fn(noSleep);
    expect(await probeServer({ fetchFn, sleep })).toEqual({
      mode: "unavailable",
      status: 401,
      detail: "Authentication required Open the URL printed by `ndx start`.",
    });
    expect(callCount()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a 404 is static at once: a plain static host offers file drop as before", async () => {
    const { fetchFn, callCount } = scriptedFetch([response(404)]);
    expect(await probeServer({ fetchFn, sleep: noSleep })).toEqual({ mode: "static" });
    expect(callCount()).toBe(1);
  });

  it("a failed request on a file:// page is static, with no retry", async () => {
    const { fetchFn, callCount } = scriptedFetch([new TypeError("Failed to fetch")]);
    expect(await probeServer({ fetchFn, sleep: noSleep, retryNetworkErrors: false })).toEqual({ mode: "static" });
    expect(callCount()).toBe(1);
  });

  it("a failed request on an http page is a server that is gone: retried, then reported as status 0", async () => {
    const { fetchFn, callCount } = scriptedFetch([new TypeError("Failed to fetch")]);
    const probe = await probeServer({ fetchFn, sleep: noSleep, retryNetworkErrors: true });
    expect(probe).toEqual({ mode: "unavailable", status: 0, detail: "Failed to fetch" });
    expect(callCount()).toBe(SERVER_PROBE_DELAYS_MS.length + 1);
  });

  it("delaysMs: [] probes exactly once, for the slow background re-probe", async () => {
    const { fetchFn, callCount } = scriptedFetch([response(503, { error: "x" })]);
    const sleep = vi.fn(noSleep);
    await probeServer({ fetchFn, sleep, delaysMs: [] });
    expect(callCount()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("an unparseable refusal body yields a null detail rather than a throw", async () => {
    const { fetchFn } = scriptedFetch([response(502)]);
    expect(await probeServer({ fetchFn, sleep: noSleep })).toEqual({ mode: "unavailable", status: 502, detail: null });
  });
});

describe("serverUnavailableCopy", () => {
  it("never tells the reader to drop files", () => {
    for (const status of [0, 401, 403, 409, 421, 500, 502, 503, 504, 418]) {
      const copy = serverUnavailableCopy({ status, detail: null }, "ndx");
      expect(`${copy.title} ${copy.body}`).not.toMatch(/drop/i);
      expect(copy.title.length).toBeGreaterThan(0);
    }
  });

  it("a hub 503 is a wait, in the hub's words, that retries on its own", () => {
    const copy = serverUnavailableCopy({ status: 503, detail: 'Project "n-dx" has no running server' }, "ndx");
    expect(copy.title).toBe("Waiting for the project server");
    expect(copy.body).toContain('Project "n-dx" has no running server');
    expect(copy.body).toContain("503");
    expect(copy.retrying).toBe(true);
  });

  it("a 401 points at the printed URL, under the project's CLI name, and does not claim retrying will fix it", () => {
    const copy = serverUnavailableCopy({ status: 401, detail: null }, "my-cli");
    expect(copy.body).toContain("`my-cli start`");
    expect(copy.body).not.toContain("{cli}");
    expect(copy.retrying).toBe(false);
  });

  it("status 0 names a server that is not answering", () => {
    const copy = serverUnavailableCopy({ status: 0, detail: "Failed to fetch" }, "ndx");
    expect(copy.title).toBe("The dashboard server is not answering");
    expect(copy.retrying).toBe(true);
  });
});
