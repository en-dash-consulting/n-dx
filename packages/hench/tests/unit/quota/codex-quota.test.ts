/**
 * Unit tests for the Codex (OpenAI) quota adapter.
 *
 * All HTTP calls are replaced with an injectable `fetchFn` mock so the tests
 * run without network access and without requiring OPENAI_API_KEY.
 *
 * Scenarios covered:
 *   - Successful fetch: percent calculation, result shape, boundary values
 *   - Missing API key (auth error before any HTTP call)
 *   - HTTP 401 / 403 auth failures
 *   - HTTP 429 rate-limit
 *   - Network connectivity error (fetch throws)
 *   - Malformed subscription response (missing/zero hard_limit_usd)
 *   - Malformed usage response (missing total_usage)
 *   - JSON parse failure
 *   - Custom apiEndpoint override
 */

import { describe, it, expect, vi } from "vitest";
import {
  fetchCodexQuota,
  type CodexQuotaResult,
  type FetchCodexQuotaOptions,
} from "../../../src/quota/codex-quota.js";

// ── Mock factory helpers ──────────────────────────────────────────────────────

/** Build a minimal mock Response object. */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * Build a mock fetchFn that returns different responses for subscription and
 * usage endpoints, identified by URL substring.
 */
function makeFetchFn(
  subscriptionResponse: Response,
  usageResponse: Response,
): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes("/dashboard/billing/subscription")) return subscriptionResponse;
    if (urlStr.includes("/dashboard/billing/usage")) return usageResponse;
    throw new Error(`Unexpected URL: ${urlStr}`);
  }) as unknown as typeof fetch;
}

/** Standard options with an injected fetchFn and no OPENAI_API_KEY side-effects. */
function makeOpts(
  overrides: Partial<FetchCodexQuotaOptions> & { fetchFn: typeof fetch },
): FetchCodexQuotaOptions {
  return {
    apiKey: "test-key",
    model: "gpt-5",
    ...overrides,
  };
}

// ── Success cases ─────────────────────────────────────────────────────────────

describe("fetchCodexQuota — success", () => {
  it("returns ok:true with a QuotaRemaining when both requests succeed", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { total_usage: 4000 }), // $40.00 used of $100 → 60% remaining
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.vendor).toBe("codex");
    expect(result.quota.model).toBe("gpt-5");
    expect(result.quota.percentRemaining).toBeCloseTo(60, 5);
  });

  it("uses the provided model in the result", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 50 }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn, model: "gpt-4o" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.model).toBe("gpt-4o");
  });

  it("clamps percentRemaining to 100 when usage is 0", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(100);
  });

  it("clamps percentRemaining to 0 when usage exceeds the limit", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 10 }),
      makeResponse(200, { total_usage: 1500 }), // $15 used > $10 limit
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBe(0);
  });

  it("computes percentRemaining correctly at exactly 50% used", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 200 }),
      makeResponse(200, { total_usage: 10000 }), // $100 used of $200 → 50% remaining
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.percentRemaining).toBeCloseTo(50, 5);
  });

  it("uses a custom apiEndpoint when provided", async () => {
    const capturedUrls: string[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      if (String(url).includes("subscription"))
        return makeResponse(200, { hard_limit_usd: 100 });
      return makeResponse(200, { total_usage: 0 });
    }) as unknown as typeof fetch;

    await fetchCodexQuota(
      makeOpts({ fetchFn: customFetch, apiEndpoint: "https://custom.example.com/v1" }),
    );

    expect(capturedUrls[0]).toContain("custom.example.com");
  });

  it("strips a trailing slash from apiEndpoint before building the URL", async () => {
    const capturedUrls: string[] = [];
    const customFetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(String(url));
      if (String(url).includes("subscription"))
        return makeResponse(200, { hard_limit_usd: 100 });
      return makeResponse(200, { total_usage: 0 });
    }) as unknown as typeof fetch;

    await fetchCodexQuota(
      makeOpts({ fetchFn: customFetch, apiEndpoint: "https://api.openai.com/" }),
    );

    expect(capturedUrls[0]).not.toMatch(/\/\/dashboard/);
    expect(capturedUrls[0]).toMatch(/openai\.com\/dashboard/);
  });
});

// ── Auth failure ──────────────────────────────────────────────────────────────

describe("fetchCodexQuota — auth failures", () => {
  it("returns ok:false kind:'auth' when no apiKey is available", async () => {
    // Remove env var for this test (it is unlikely to be set, but be explicit)
    const savedEnv = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];

    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await fetchCodexQuota({ model: "gpt-5", fetchFn });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("auth");
    expect(fetchFn).not.toHaveBeenCalled();

    // Restore
    if (savedEnv !== undefined) process.env["OPENAI_API_KEY"] = savedEnv;
  });

  it("returns ok:false kind:'auth' on HTTP 401 from subscription", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(401, { error: "Unauthorized" }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("auth");
  });

  it("returns ok:false kind:'auth' on HTTP 403 from subscription", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(403, { error: "Forbidden" }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("auth");
  });

  it("returns ok:false kind:'auth' on HTTP 401 from usage", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(401, { error: "Unauthorized" }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("auth");
  });
});

// ── Rate-limit ────────────────────────────────────────────────────────────────

describe("fetchCodexQuota — rate-limit", () => {
  it("returns ok:false kind:'rate-limit' on HTTP 429 from subscription", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(429, { error: "Too Many Requests" }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("rate-limit");
  });

  it("returns ok:false kind:'rate-limit' on HTTP 429 from usage", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(429, { error: "Too Many Requests" }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("rate-limit");
  });
});

// ── Network failure ───────────────────────────────────────────────────────────

describe("fetchCodexQuota — network failure", () => {
  it("returns ok:false kind:'network' when fetch throws on subscription", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("subscription")) throw new Error("ECONNREFUSED");
      return makeResponse(200, { total_usage: 0 });
    }) as unknown as typeof fetch;

    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("network");
    expect(result.error.message).toContain("ECONNREFUSED");
  });

  it("returns ok:false kind:'network' when fetch throws on usage", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("subscription"))
        return makeResponse(200, { hard_limit_usd: 100 });
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("network");
    expect(result.error.message).toContain("socket hang up");
  });

  it("returns ok:false kind:'network' on HTTP 500", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(500, { error: "Internal Server Error" }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("network");
  });
});

// ── Parse / malformed response ────────────────────────────────────────────────

describe("fetchCodexQuota — parse failures", () => {
  it("returns ok:false kind:'parse' when hard_limit_usd is missing", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { plan: "free" }), // missing hard_limit_usd
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("parse");
  });

  it("returns ok:false kind:'parse' when hard_limit_usd is zero", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 0 }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("parse");
  });

  it("returns ok:false kind:'parse' when hard_limit_usd is negative", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: -5 }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("parse");
  });

  it("returns ok:false kind:'parse' when total_usage is missing", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { object: "list" }), // missing total_usage
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("parse");
  });

  it("returns ok:false kind:'parse' when the subscription response is not valid JSON", async () => {
    const badResponse: Response = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response;

    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("subscription")) return badResponse;
      return makeResponse(200, { total_usage: 0 });
    }) as unknown as typeof fetch;

    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected ok:false");
    expect(result.error.kind).toBe("parse");
  });
});

// ── Never-throws contract ─────────────────────────────────────────────────────

describe("fetchCodexQuota — never-throws contract", () => {
  it("does not throw even when the fetch function throws an unexpected error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch is not a function");
    }) as unknown as typeof fetch;

    await expect(fetchCodexQuota(makeOpts({ fetchFn }))).resolves.toBeDefined();
  });

  it("always returns an object with an ok boolean", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { total_usage: 1000 }),
    );
    const result: CodexQuotaResult = await fetchCodexQuota(makeOpts({ fetchFn }));
    expect(typeof result.ok).toBe("boolean");
  });
});

// ── Adapter boundary: no Codex types leak ─────────────────────────────────────

describe("fetchCodexQuota — adapter boundary", () => {
  it("result.quota has only vendor, model, and percentRemaining fields", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { total_usage: 5000 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");

    const keys = Object.keys(result.quota).sort();
    expect(keys).toEqual(["model", "percentRemaining", "vendor"]);
  });

  it("vendor field is always 'codex'", async () => {
    const fetchFn = makeFetchFn(
      makeResponse(200, { hard_limit_usd: 100 }),
      makeResponse(200, { total_usage: 0 }),
    );
    const result = await fetchCodexQuota(makeOpts({ fetchFn }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.quota.vendor).toBe("codex");
  });
});
