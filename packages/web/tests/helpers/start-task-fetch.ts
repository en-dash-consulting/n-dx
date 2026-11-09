import { vi } from "vitest";
import type { PrepResponse } from "../../src/viewer/components/prepare-task-model.js";
import { prepFixture } from "./prep-fixture.js";

/** One canned HTTP answer. */
export interface StubReply {
  status: number;
  body: unknown;
}

/** A request StartTaskButton made, with its JSON body parsed. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

export interface StartFetchOptions {
  /**
   * `GET /api/hench/prep/:taskId`. A `PrepResponse` answers 200; a
   * `StubReply` answers as given. Defaults to a task that already carries a
   * saved run block, so a test about the execute is not also about saving.
   */
  prep?: PrepResponse | StubReply;
  /**
   * `PUT /api/hench/prep/:taskId`. The one click never sends one (the server
   * saves `saveRun` itself); answered and recorded so a test can assert that.
   */
  save?: StubReply;
  /** `POST /api/hench/execute`, in order; the last answer repeats. Defaults to a 200 start. */
  execute?: StubReply | StubReply[];
  /** `GET /api/hub/queue`, for a queued start. */
  queue?: unknown;
}

/** A prep answer for a task carrying saved settings. */
export function savedPrep(overrides: Partial<PrepResponse> = {}): PrepResponse {
  return prepFixture({ saved: { tier: "heavy" }, savedVersion: "a1b2c3d4e5f6", ...overrides });
}

function isReply(value: unknown): value is StubReply {
  return typeof value === "object" && value !== null && "status" in value && "body" in value && !("resolved" in value);
}

/**
 * Stub the global fetch with the routes a Start click touches — the prep read,
 * the settings save, the execute and the hub queue — and record every call.
 */
export function stubStartFetch(options: StartFetchOptions = {}) {
  const calls: RecordedCall[] = [];
  const executeReplies = Array.isArray(options.execute)
    ? options.execute
    : [options.execute ?? { status: 200, body: { runId: "exec-1" } }];
  let executes = 0;

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = { ...(init.headers as Record<string, string> | undefined) };
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, method, headers, body });

    let reply: StubReply;
    if (url.startsWith("/api/hench/prep/") && method === "GET") {
      const prep = options.prep ?? savedPrep();
      reply = isReply(prep) ? prep : { status: 200, body: prep };
    } else if (url.startsWith("/api/hench/prep/") && method === "PUT") {
      reply = options.save ?? { status: 200, body: { saved: body?.run ?? null, version: "f00f00f00f00" } };
    } else if (url === "/api/hench/execute") {
      reply = executeReplies[Math.min(executes, executeReplies.length - 1)];
      executes++;
    } else if (url === "/api/hub/queue" && options.queue !== undefined) {
      reply = { status: 200, body: options.queue };
    } else {
      reply = { status: 200, body: {} };
    }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    fetch: fetchMock,
    calls,
    /** The execute POSTs, in order. */
    executes: () => calls.filter((c) => c.url === "/api/hench/execute"),
    /** Client-side settings saves (PUTs), in order: none from the one click. */
    saves: () => calls.filter((c) => c.url.startsWith("/api/hench/prep/") && c.method === "PUT"),
  };
}
