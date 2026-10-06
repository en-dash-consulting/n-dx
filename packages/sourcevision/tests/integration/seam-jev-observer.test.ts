/**
 * Injection seam contract test for the Jev observer.
 *
 * `askJev` lives in `@n-dx/llm-client` (foundation tier) and so cannot import
 * sourcevision's run ledger. The accounting is inverted through
 * `setJevObserver`, and sourcevision registers the ledger's recorders in
 * `cmdAnalyze`'s setup. TypeScript checks that `recordLLMCall` and
 * `recordJudgmentCache` are structurally acceptable as `JevObserver` methods;
 * it cannot check that the client actually calls them, nor that the numbers
 * arrive in the shape the ledger reports. Both are what the ledger assertions
 * in the old `jev-client.test.ts` covered before the move, so they live here.
 *
 * @see packages/llm-client/src/jev-client.ts — the injection site
 * @see packages/sourcevision/src/cli/commands/analyze.ts — the registration site
 * @see packages/llm-client/CLAUDE.md — Injection seam registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  askJev,
  choice,
  setJevObserver,
  configureJudgmentCache,
  JEV_VENDOR,
} from "@n-dx/llm-client";
import {
  startRunLedger,
  snapshotRunLedger,
  recordLLMCall,
  recordJudgmentCache,
} from "../../src/analyzers/run-ledger.js";

const env = { TYPESAFE_API_KEY: "tsk_test" } as NodeJS.ProcessEnv;
const noSleep = async () => {};

/**
 * Exactly what `cmdAnalyze` registers. Kept as one expression so a change to
 * the registration there is a visible diff against this line.
 */
function wireLedgerObserver(): void {
  setJevObserver({ onCall: recordLLMCall, onCacheStats: recordJudgmentCache });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
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

beforeEach(() => {
  startRunLedger("cascade");
});

afterEach(() => {
  setJevObserver(null);
  configureJudgmentCache(undefined);
});

describe("Jev observer seam — runtime callback invocation", () => {
  it("lands a successful call in the ledger under its task class, vendor and model", async () => {
    wireLedgerObserver();
    const fetchImpl = vi.fn(async () => jsonResponse(okBody));

    await askJev(request, { fetchImpl, env, sleep: noSleep, taskClass: "code.classify" });

    const { byTaskClass } = snapshotRunLedger().llm;
    expect(byTaskClass["code.classify"]).toMatchObject({
      calls: 1,
      inputTokens: 120,
      outputTokens: 6,
      vendor: JEV_VENDOR,
      model: "jev-1.13.0",
    });
  });

  it("records nothing for a failed call", async () => {
    wireLedgerObserver();
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));

    await askJev(request, { fetchImpl, env, sleep: noSleep, taskClass: "code.classify" }).catch(() => {});

    expect(snapshotRunLedger().llm.byTaskClass).toEqual({});
  });

  it("lands judgment-cache hits and misses in the ledger while the cache is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-seam-jev-"));
    configureJudgmentCache({ svDir: dir });
    wireLedgerObserver();
    try {
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        const sent = JSON.parse(init.body as string);
        const answers: Record<string, unknown> = {};
        for (const id of Object.keys(sent.questions)) {
          answers[id] = { type: "choice", choice: "service", probabilities: { service: 0.9, utility: 0.05, none: 0.05 }, confidence: 0.8 };
        }
        return jsonResponse({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 1 } });
      });

      const two = {
        state: { files: { f0: { path: "a.ts" }, f1: { path: "b.ts" } } },
        questions: {
          f0: choice("Which archetype fits `files.f0`?", { service: "s", utility: "u", none: "n" }),
          f1: choice("Which archetype fits `files.f1`?", { service: "s", utility: "u", none: "n" }),
        },
      };

      await askJev(two, { fetchImpl, env, sleep: noSleep });
      await askJev(two, { fetchImpl, env, sleep: noSleep });
      const changed = { ...two, state: { files: { f0: { path: "a.ts" }, f1: { path: "b2.ts" } } } };
      await askJev(changed, { fetchImpl, env, sleep: noSleep });

      expect(snapshotRunLedger().llm.judgmentCache).toEqual({ hits: 3, misses: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports no cache stats while the cache is unconfigured, so the ledger omits the bucket", async () => {
    wireLedgerObserver();
    const fetchImpl = vi.fn(async () => jsonResponse(okBody));

    await askJev(request, { fetchImpl, env, sleep: noSleep });

    expect(snapshotRunLedger().llm.judgmentCache).toBeUndefined();
  });
});

describe("Jev observer seam — registration", () => {
  it("cmdAnalyze's bootstrap registers the ledger, so a Jev call made after it is accounted for", async () => {
    // The whole seam is one line in initAndLoadLLMConfig. Deleting it leaves
    // every other test here green — they register the observer themselves — and
    // silently drops Jev from the ledgers of both `sv analyze` and `sv narrate`,
    // which share this bootstrap. So this test registers nothing of its own.
    const { initAndLoadLLMConfig } = await import("../../src/cli/commands/analyze.js");
    const dir = mkdtempSync(join(tmpdir(), "sv-seam-bootstrap-"));
    try {
      setJevObserver(null);
      await initAndLoadLLMConfig(dir);
      startRunLedger("cascade");

      const fetchImpl = vi.fn(async () => jsonResponse(okBody));
      await askJev(request, { fetchImpl, env, sleep: noSleep, taskClass: "code.classify" });

      expect(snapshotRunLedger().llm.byTaskClass["code.classify"]).toMatchObject({
        calls: 1,
        vendor: JEV_VENDOR,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Jev observer seam — optional-callback safety", () => {
  it("completes the call with no observer registered", async () => {
    setJevObserver(null);
    const fetchImpl = vi.fn(async () => jsonResponse(okBody));

    const res = await askJev(request, { fetchImpl, env, sleep: noSleep });

    expect(res.answers.f0).toMatchObject({ type: "choice", choice: "service" });
    expect(snapshotRunLedger().llm.byTaskClass).toEqual({});
  });

  it("completes the call with an observer that implements neither callback", async () => {
    setJevObserver({});
    const fetchImpl = vi.fn(async () => jsonResponse(okBody));

    await expect(askJev(request, { fetchImpl, env, sleep: noSleep })).resolves.toMatchObject({
      model: "jev-1.13.0",
    });
  });

  it("completes the call with onCall alone, leaving cache stats unreported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-seam-jev-partial-"));
    configureJudgmentCache({ svDir: dir });
    setJevObserver({ onCall: recordLLMCall });
    try {
      const fetchImpl = vi.fn(async () => jsonResponse(okBody));

      await askJev(request, { fetchImpl, env, sleep: noSleep, taskClass: "code.classify" });

      const { llm } = snapshotRunLedger();
      expect(llm.byTaskClass["code.classify"]).toMatchObject({ calls: 1 });
      expect(llm.judgmentCache).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
