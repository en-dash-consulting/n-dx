import { describe, it, expect, vi } from "vitest";
import { askJev, choice, noul, score, JEV_ENDPOINT, JEV_MODEL } from "../../../src/analyzers/jev-client.js";
import { ClaudeClientError } from "@n-dx/llm-client";

const env = { TYPESAFE_API_KEY: "tsk_test" } as NodeJS.ProcessEnv;
const noSleep = vi.fn(async () => {});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const okBody = {
  model: "jev-1.13.0",
  answers: {
    f0: { type: "choice", choice: "service", probabilities: { service: 0.8, utility: 0.15, none: 0.05 }, confidence: 0.7 },
  },
  usage: { input_tokens: 120, output_tokens: 6 },
};

const request = {
  state: { files: { f0: { path: "src/analyzer.ts" } } },
  questions: { f0: choice("Which archetype fits `files.f0`?", { service: "Domain logic", utility: "Helpers", none: "No fit" }) },
};

describe("askJev — request and response mapping", () => {
  it("posts state, model and questions with a bearer key and maps answers + usage", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody));
    const res = await askJev(request, { fetchImpl, env, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tsk_test");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ state: request.state, model: JEV_MODEL, questions: request.questions });

    expect(res.model).toBe("jev-1.13.0");
    expect(res.answers.f0.choice).toBe("service");
    expect(res.answers.f0.probabilities.service).toBe(0.8);
    expect(res.tokenUsage).toEqual({ input: 120, output: 6 });
  });

  it("rejects a response that lacks an answer for a question id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { model: "jev", answers: {} }));
    await expect(askJev(request, { fetchImpl, env, sleep: noSleep })).rejects.toMatchObject({
      name: "ClaudeClientError",
      reason: "unknown",
      message: expect.stringContaining('"f0"'),
    });
  });
});

describe("askJev — error mapping", () => {
  it("fails with reason auth and never calls fetch when the key is absent", async () => {
    const fetchImpl = vi.fn();
    const err = await askJev(request, { fetchImpl, env: {} as NodeJS.ProcessEnv }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeClientError);
    expect(err.reason).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 401 to a non-retryable auth error after a single attempt", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid key", { status: 401 }));
    const err = await askJev(request, { fetchImpl, env, sleep: noSleep }).catch((e) => e);
    expect(err.reason).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("invalid key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 422 to a non-retryable error carrying the server's explanation", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"detail":"criteria must have at least 2 options"}', { status: 422 }));
    const err = await askJev(request, { fetchImpl, env, sleep: noSleep }).catch((e) => e);
    expect(err.reason).toBe("unknown");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("at least 2 options");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    const res = await askJev(request, { fetchImpl, env, sleep });
    expect(res.answers.f0.choice).toBe("service");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after three transient failures with a retryable rate-limit error", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const err = await askJev(request, { fetchImpl, env, sleep: noSleep }).catch((e) => e);
    expect(err.reason).toBe("rate-limit");
    expect(err.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats 5xx as transient and reports unknown once exhausted", async () => {
    const fetchImpl = vi.fn(async () => new Response("overloaded", { status: 529 }));
    const err = await askJev(request, { fetchImpl, env, sleep: noSleep }).catch((e) => e);
    expect(err.reason).toBe("unknown");
    expect(err.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("askJev — noul and score answers", () => {
  const mixed = {
    state: { finding: { text: "Zone A imports Zone B's internals" } },
    questions: {
      sev: score("How severe is `finding`?", ["no action", "costs time later", "fix now"]),
      frag: noul("Does `finding` describe a boundary violation?"),
    },
  };

  it("parses a score with an array distribution and a noul probability", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      model: "jev-1.13.0",
      answers: {
        sev: { type: "score", score: 1.2, probabilities: [0.1, 0.6, 0.3], confidence: 0.55, legend: { 0: "no action", 1: "costs time later", 2: "fix now" } },
        frag: { type: "noul", noul: 0.87 },
      },
    }));
    const res = await askJev(mixed, { fetchImpl, env, sleep: noSleep });
    expect(res.answers.sev).toEqual({ type: "score", score: 1.2, probabilities: [0.1, 0.6, 0.3], confidence: 0.55 });
    expect(res.answers.frag).toEqual({ type: "noul", noul: 0.87 });
  });

  it("accepts a score distribution keyed by level index", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      model: "jev",
      answers: {
        sev: { type: "score", score: 0.4, probabilities: { "1": 0.3, "0": 0.6, "2": 0.1 }, confidence: 0.5 },
        frag: { type: "noul", noul: 0.1 },
      },
    }));
    const res = await askJev(mixed, { fetchImpl, env, sleep: noSleep });
    expect((res.answers.sev as { probabilities: number[] }).probabilities).toEqual([0.6, 0.3, 0.1]);
  });

  it("rejects an answer whose type does not match its question", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      model: "jev",
      answers: { sev: { type: "noul", noul: 0.5 }, frag: { type: "noul", noul: 0.5 } },
    }));
    await expect(askJev(mixed, { fetchImpl, env, sleep: noSleep })).rejects.toMatchObject({
      reason: "unknown",
      message: expect.stringContaining('score answer for question "sev"'),
    });
  });
});
