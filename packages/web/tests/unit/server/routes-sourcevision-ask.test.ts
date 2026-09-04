/**
 * POST /api/sourcevision/ask — success path, grounding, config-driven
 * vendor/model resolution, and every named failure mode.
 *
 * The LLM client is injected rather than mocked at the module level, so these
 * tests never touch a vendor, a credential, or the network. The stub records
 * the request it was handed, which is what makes the grounding assertion
 * possible: the test can check exactly which analysis facts reached the model.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { ClaudeClientError, VERIFY_CREDENTIALS_STEP, authFailureGuidance } from "@n-dx/llm-client";
import type { CompletionRequest, CompletionResult, LLMClient } from "@n-dx/llm-client";
import { resolveStore } from "@n-dx/rex";
import { REFINEMENT_FENCE_TAG } from "../../../src/server/prd-refinement.js";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleSourcevisionAskRoute,
  type HandleSourcevisionAskOptions,
} from "../../../src/server/routes-sourcevision-ask.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

// ---------------------------------------------------------------------------
// Fixture analysis data
// ---------------------------------------------------------------------------

const MANIFEST = {
  schemaVersion: "1",
  toolVersion: "0.5.1",
  analyzedAt: "2026-02-02T00:00:00.000Z",
  targetPath: "/repo/ask-fixture",
  gitBranch: "feature/ask",
  language: "typescript",
  languages: ["typescript"],
  modules: {},
};

const INVENTORY = {
  files: [
    {
      path: "src/checkout/pipeline.ts",
      size: 40_000,
      language: "typescript",
      lineCount: 1_400,
      hash: "h1",
      role: "source",
      category: "payments",
    },
    {
      path: "src/util/format.ts",
      size: 900,
      language: "typescript",
      lineCount: 40,
      hash: "h2",
      role: "source",
      category: "formatting",
    },
  ],
  summary: {
    totalFiles: 2,
    totalLines: 1_440,
    byLanguage: { typescript: 2 },
    byRole: { source: 2 },
    byCategory: { payments: 1, formatting: 1 },
  },
};

const ZONES = {
  zones: [
    {
      id: "checkout-core",
      name: "Checkout Core",
      description: "Order capture, payment authorization, and receipt emission.",
      files: ["src/checkout/pipeline.ts"],
      entryPoints: ["src/checkout/pipeline.ts"],
      cohesion: 0.41,
      coupling: 0.72,
    },
    {
      id: "shared-format",
      name: "Shared Formatting",
      description: "Currency and date formatting helpers.",
      files: ["src/util/format.ts"],
      entryPoints: [],
      cohesion: 0.95,
      coupling: 0.05,
    },
  ],
  crossings: [],
  unzoned: [],
  insights: ["Checkout Core carries both transport and domain concerns."],
  findings: [
    {
      type: "anti-pattern",
      pass: 2,
      scope: "checkout-core",
      text: "God file: src/checkout/pipeline.ts owns routing, validation, and persistence.",
      severity: "critical",
    },
    {
      type: "suggestion",
      pass: 2,
      scope: "shared-format",
      text: "Formatting helpers could move next to their only consumer.",
      severity: "info",
    },
  ],
};

const IMPORTS = {
  edges: [],
  external: [],
  summary: {
    totalEdges: 12,
    totalExternal: 3,
    circularCount: 1,
    circulars: [{ cycle: ["src/checkout/pipeline.ts", "src/util/format.ts"] }],
    mostImported: [{ path: "src/util/format.ts", count: 7 }],
    avgImportsPerFile: 6,
  },
};

const COMPONENTS = {
  components: [{ name: "CheckoutForm", file: "src/checkout/Form.tsx", kind: "function", props: [] }],
  usageEdges: [],
  routeModules: [],
  routeTree: [],
  serverRoutes: [],
  summary: {
    totalComponents: 1,
    totalRouteModules: 0,
    totalUsageEdges: 0,
    totalServerRoutes: 0,
    routeConventions: {},
    mostUsedComponents: [],
    layoutDepth: 0,
  },
};

const CONTEXT_MD = "# Ask fixture\n\nCheckout is the riskiest area of this repository.";

// ---------------------------------------------------------------------------
// Stub client
// ---------------------------------------------------------------------------

interface StubClient {
  /** Requests the route handed to `complete()`, in order. */
  requests: CompletionRequest[];
  /** Vendors the factory was asked for, in order. */
  vendors: string[];
  options: HandleSourcevisionAskOptions;
}

/**
 * Build an injected client factory backed by `respond`.
 *
 * `respond` may resolve a {@link CompletionResult}, reject, or never settle —
 * the last of which is how the timeout path is exercised without waiting on a
 * real provider.
 */
function stubClient(respond: () => Promise<CompletionResult>): StubClient {
  const stub: StubClient = {
    requests: [],
    vendors: [],
    options: {},
  };
  stub.options = {
    createClient: ({ vendor }) => {
      stub.vendors.push(vendor);
      const client: LLMClient = {
        mode: "api",
        complete: (request) => {
          stub.requests.push(request);
          return respond();
        },
      };
      return client;
    },
  };
  return stub;
}

function answering(text: string, tokenUsage?: CompletionResult["tokenUsage"]): () => Promise<CompletionResult> {
  return () => Promise.resolve(tokenUsage ? { text, tokenUsage } : { text });
}

function failing(err: Error): () => Promise<CompletionResult> {
  return () => Promise.reject(err);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe("POST /api/sourcevision/ask", () => {
  let tmpDir: string;
  let svDir: string;
  let ctx: ServerContext;
  let server: Server;
  let baseUrl: string;
  /** Reassigned per test before the request is made. */
  let routeOptions: HandleSourcevisionAskOptions;

  async function writeAnalysis(): Promise<void> {
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(MANIFEST));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(INVENTORY));
    await writeFile(join(svDir, "zones.json"), JSON.stringify(ZONES));
    await writeFile(join(svDir, "imports.json"), JSON.stringify(IMPORTS));
    await writeFile(join(svDir, "components.json"), JSON.stringify(COMPONENTS));
    await writeFile(join(svDir, "CONTEXT.md"), CONTEXT_MD);
  }

  function ask(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/sourcevision/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-ask-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeAnalysis();

    ctx = { projectDir: tmpDir, svDir, rexDir: join(tmpDir, ".rex"), dev: false };
    routeOptions = {};
    const started = await startRouteTestServer((req, res) =>
      handleSourcevisionAskRoute(req, res, ctx, routeOptions),
    );
    server = started.server;
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it("answers with the model text, resolved vendor/model, tokens, and sources", async () => {
    const stub = stubClient(answering("Checkout Core is the weak point.", { input: 900, output: 60 }));
    routeOptions = stub.options;

    const res = await ask({ prompt: "Where is the architectural risk?" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.answer).toBe("Checkout Core is the weak point.");
    expect(body.vendor).toBe("claude");
    expect(typeof body.model).toBe("string");
    expect(body.model.length).toBeGreaterThan(0);
    expect(body.tokens).toEqual({ input: 900, output: 60 });
    expect(body.contextSources).toEqual([
      "manifest.json",
      "inventory.json",
      "imports.json",
      "zones.json",
      "components.json",
      "CONTEXT.md",
    ]);
  });

  it("reports zeroed tokens rather than omitting them when the provider counts none", async () => {
    // The usage rollup adds these up; an absent field would make every consumer
    // handle two shapes for the same successful call.
    routeOptions = stubClient(answering("No usage reported.")).options;

    const body = await (await ask({ prompt: "Anything?" })).json();
    expect(body.tokens).toEqual({ input: 0, output: 0 });
  });

  // ── Grounding ─────────────────────────────────────────────────────────────

  it("sends the assembled .sourcevision context to the LLM call", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    await ask({ prompt: "Summarize the risk." });

    expect(stub.requests).toHaveLength(1);
    const prompt = stub.requests[0].prompt;

    // Every artifact's distinguishing fact must be present — this is the
    // assertion that the answer is grounded in analysis rather than in the
    // model's priors.
    expect(prompt).toContain("/repo/ask-fixture"); // manifest
    expect(prompt).toContain("src/checkout/pipeline.ts"); // inventory
    expect(prompt).toContain("Checkout Core"); // zones
    expect(prompt).toContain("cohesion 0.41");
    expect(prompt).toContain("God file: src/checkout/pipeline.ts"); // findings
    expect(prompt).toContain("Checkout is the riskiest area"); // CONTEXT.md
    expect(prompt).toContain("imported by 7"); // imports summary

    // And the question itself, plus the instruction that fences the model in.
    expect(prompt).toContain("Summarize the risk.");
    expect(prompt).toContain("Answer ONLY from the analysis provided.");
  });

  it("derives next steps from the findings and includes them in the context", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    await ask({ prompt: "What should I do first?" });
    expect(stub.requests[0].prompt).toContain("Prioritized next steps");
  });

  it("carries an optional seed into the context as a focus section", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    await ask({
      prompt: "Explain this in plain language.",
      seed: {
        kind: "finding",
        id: "checkout-core",
        text: "God file: src/checkout/pipeline.ts owns routing, validation, and persistence.",
      },
    });

    const prompt = stub.requests[0].prompt;
    expect(prompt).toContain("What the user is looking at");
    expect(prompt).toContain("Surface: finding");
    expect(prompt).toContain("Identifier: `checkout-core`");
  });

  it("carries a finding seed's zone and files through to the model intact", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    const res = await ask({
      prompt: "Explain this finding in plain language.",
      seed: {
        kind: "finding",
        id: "anti-pattern:checkout-core:God file",
        text: "God file: src/checkout/pipeline.ts owns routing, validation, and persistence.",
        zone: "checkout-core",
        files: ["src/checkout/pipeline.ts", "src/checkout/validate.ts"],
        labels: { type: "anti-pattern", severity: "critical" },
      },
    });
    expect(res.status).toBe(200);

    const prompt = stub.requests[0].prompt;
    // The fields the row showed, reaching the model as fields — this is the
    // difference between an explanation of THIS finding and an explanation of
    // its category.
    expect(prompt).toContain("Zone: `checkout-core`");
    expect(prompt).toContain("`src/checkout/pipeline.ts`");
    expect(prompt).toContain("`src/checkout/validate.ts`");
    expect(prompt).toContain("type: anti-pattern");
    expect(prompt).toContain("severity: critical");
    // And the instructions that make the answer use them.
    expect(prompt).toContain("name its zone and its files explicitly");
    expect(prompt).toContain("Say what a fix would touch");
  });

  it("does not add the seeded rules to an unseeded question", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    await ask({ prompt: "Which zones are most coupled?" });

    const prompt = stub.requests[0].prompt;
    expect(prompt).not.toContain("What the user is looking at");
    expect(prompt).not.toContain("Say what a fix would touch");
  });

  it("refuses a seed field it does not honor rather than dropping it", async () => {
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    const res = await ask({
      prompt: "Explain this.",
      seed: { kind: "finding", severity: "critical" },
    });

    // `severity` belongs inside `labels`. A client that guessed the shape must
    // be told, not silently answered without the field it thought it sent.
    expect(res.status).toBe(400);
    expect(stub.requests).toHaveLength(0);
  });

  // ── Vendor / model resolution ─────────────────────────────────────────────

  it("resolves vendor and model from project config, not from a hardcoded pair", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { model: "qwen-3-coder" } } }),
    );
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    const body = await (await ask({ prompt: "Which model answered?" })).json();

    expect(body.vendor).toBe("local");
    expect(body.model).toBe("qwen-3-coder");
    // The same pair reached the client factory and the completion request.
    expect(stub.vendors).toEqual(["local"]);
    expect(stub.requests[0].model).toBe("qwen-3-coder");
  });

  it("honors an llm.routes reroute of the sourcevision.ask task class", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "local",
          local: { model: "qwen-3-coder" },
          routes: { "sourcevision.ask": "light" },
          tiers: { local: { light: "qwen-1.5b" } },
        },
      }),
    );
    routeOptions = stubClient(answering("ok")).options;

    const body = await (await ask({ prompt: "Cheap question." })).json();
    expect(body.model).toBe("qwen-1.5b");
  });

  it("lets .n-dx.local.json override the shared vendor choice", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { vendor: "local", local: { model: "on-this-machine" } } }),
    );
    routeOptions = stubClient(answering("ok")).options;

    const body = await (await ask({ prompt: "Whose config wins?" })).json();
    expect(body.vendor).toBe("local");
    expect(body.model).toBe("on-this-machine");
  });

  // ── Request validation ────────────────────────────────────────────────────

  it("rejects a missing prompt", async () => {
    routeOptions = stubClient(answering("never")).options;
    const res = await ask({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.kind).toBe("invalid_request");
    expect(body.error).toContain("prompt");
  });

  it("rejects an empty prompt", async () => {
    const stub = stubClient(answering("never"));
    routeOptions = stub.options;
    const res = await ask({ prompt: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("invalid_request");
    // No tokens were spent on an unanswerable request.
    expect(stub.requests).toHaveLength(0);
  });

  it("rejects an over-long prompt", async () => {
    const res = await ask({ prompt: "x".repeat(4_001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("4000 characters");
  });

  it("rejects an unrecognized field instead of silently dropping it", async () => {
    const res = await ask({ prompt: "hello", model: "claude-opus-5" });
    expect(res.status).toBe(400);
    expect((await res.json()).kind).toBe("invalid_request");
  });

  it("rejects a non-JSON body", async () => {
    const res = await ask("not json at all");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.kind).toBe("invalid_request");
    expect(body.error).toContain("JSON");
  });

  // ── No analysis ───────────────────────────────────────────────────────────

  it("refuses to answer when there is no analysis to ground the answer in", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-ask-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const stub = stubClient(answering("should not be called"));
    const emptyCtx: ServerContext = {
      projectDir: emptyDir,
      svDir: emptySvDir,
      rexDir: join(emptyDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleSourcevisionAskRoute(req, res, emptyCtx, stub.options),
    );
    try {
      const res = await fetch(`${started.baseUrl}/api/sourcevision/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "What does this project do?" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.kind).toBe("no_analysis");
      expect(body.suggestion).toContain("analyze");
      expect(stub.requests).toHaveLength(0);
    } finally {
      await closeRouteTestServer(started.server);
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  // ── LLM failure modes ─────────────────────────────────────────────────────

  it("names a timeout, rather than hanging, when the call outlives the configured budget", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ sourcevision: { ask: { timeoutMs: 50 } } }),
    );
    // Never settles: without the timeout race this request would hang until the
    // client gave up or the test timed out.
    routeOptions = stubClient(() => new Promise<CompletionResult>(() => {})).options;

    const res = await ask({ prompt: "Take your time." });
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.kind).toBe("timeout");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("passes the configured budget down to the provider as well as racing it", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ sourcevision: { ask: { timeoutMs: 4_000 } } }),
    );
    const stub = stubClient(answering("ok"));
    routeOptions = stub.options;

    await ask({ prompt: "Bound yourself." });
    expect(stub.requests[0].timeoutMs).toBe(4_000);
  });

  it("names a rate limit and reports the retry delay the vendor supplied", async () => {
    routeOptions = stubClient(
      failing(new ClaudeClientError("429 rate limit exceeded", "rate-limit", true, 7_500)),
    ).options;

    const res = await ask({ prompt: "Too many questions." });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.kind).toBe("rate_limit");
    expect(body.retryAfterMs).toBe(7_500);
  });

  it("distinguishes an auth failure from a rate limit and a timeout", async () => {
    routeOptions = stubClient(
      failing(new ClaudeClientError("401 invalid api key", "auth", false)),
    ).options;

    const res = await ask({ prompt: "Who am I?" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.kind).toBe("auth");
    expect(body.suggestion.length).toBeGreaterThan(0);
  });

  // The dashboard must state the same cause and the same fix as every CLI
  // surface, so the steps are asserted to BE llm-client's array rather than to
  // merely resemble it — a paraphrase would satisfy a reader and still leave a
  // second copy free to drift from the canonical one.
  it("sends llm-client's canonical remediation for a credential failure", async () => {
    routeOptions = stubClient(
      failing(new ClaudeClientError("401 invalid api key", "auth", false)),
    ).options;

    const body = await (await ask({ prompt: "Who am I?" })).json();
    const guidance = authFailureGuidance("claude");
    expect(body.remediation).toEqual(guidance.remediation);
    expect(body.remediation.at(-1)).toBe(VERIFY_CREDENTIALS_STEP);
    expect(body.error).toContain(guidance.headline);
  });

  it("still sends canonical remediation when the message carries no auth signal", async () => {
    // The provider knew this was auth; the message says nothing a text
    // classifier can match. Without deriving from the resolved kind, the reply
    // was "Failed to ask SourceVision: the door is shut" under an auth code.
    routeOptions = stubClient(
      failing(new ClaudeClientError("the door is shut", "auth", false)),
    ).options;

    const body = await (await ask({ prompt: "Who am I?" })).json();
    expect(body.kind).toBe("auth");
    expect(body.error).toBe(authFailureGuidance("claude").headline);
    expect(body.error).not.toContain("the door is shut");
    expect(body.remediation.at(-1)).toBe(VERIFY_CREDENTIALS_STEP);
  });

  it("describes the mode it named when the classifier could not read the message", async () => {
    // Same defect as above for a non-auth mode: the code said rate_limit while
    // the wording fell through to the generic "Failed to ..." branch.
    routeOptions = stubClient(
      failing(new ClaudeClientError("", "rate-limit", true)),
    ).options;

    const body = await (await ask({ prompt: "Again?" })).json();
    expect(body.kind).toBe("rate_limit");
    expect(body.error).toMatch(/rate limit/i);
    expect(body.error).not.toMatch(/^Failed to ask SourceVision/);
    expect(body.suggestion.trim().length).toBeGreaterThan(0);
  });

  it("reports an unclassifiable provider failure as a named llm_error, not a bare 500", async () => {
    routeOptions = stubClient(failing(new Error("something went sideways"))).options;

    const res = await ask({ prompt: "What now?" });
    expect(res.status).toBe(502);
    expect((await res.json()).kind).toBe("llm_error");
  });

  it("reports a client that cannot be constructed as a named failure", async () => {
    routeOptions = {
      createClient: () => {
        throw new ClaudeClientError("not logged in", "auth", false);
      },
    };

    const res = await ask({ prompt: "Ready?" });
    expect(res.status).toBe(401);
    expect((await res.json()).kind).toBe("auth");
  });

  // ── Dispatch ──────────────────────────────────────────────────────────────

  it("rejects a non-POST method on the ask path", async () => {
    const res = await fetch(`${baseUrl}/api/sourcevision/ask`);
    expect(res.status).toBe(405);
    expect((await res.json()).error).toContain("POST");
  });

  it("does not claim unrelated paths", async () => {
    const res = await fetch(`${baseUrl}/api/sv/manifest`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("matches the ask path with a query string attached", async () => {
    routeOptions = stubClient(answering("ok")).options;
    const res = await fetch(`${baseUrl}/api/sourcevision/ask?_=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Cache-buster attached." }),
    });
    expect(res.status).toBe(200);
  });

  // ── Refine mode ───────────────────────────────────────────────────────────

  describe("mode: refine", () => {
    /** Seed a PRD through the store, so the tree on disk is the real shape. */
    async function seedPRD(): Promise<void> {
      await mkdir(ctx.rexDir, { recursive: true });
      await (await resolveStore(ctx.rexDir)).saveDocument({
        schema: "rex/v1",
        title: "Ask Fixture PRD",
        items: [{
          id: "epic-1",
          title: "Checkout hardening",
          level: "epic",
          status: "pending",
          children: [{
            id: "task-1",
            title: "Split the god file",
            level: "task",
            status: "pending",
            priority: "medium",
            description: "Original description.",
            acceptanceCriteria: ["It is smaller"],
          }],
        }],
      } as never);
    }

    /** A model answer carrying one proposal block. */
    function withProposals(prose: string, raw: unknown[]): string {
      return `${prose}\n\n\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify(raw)}\n\`\`\``;
    }

    it("puts the PRD in the prompt and asks for proposals", async () => {
      await seedPRD();
      const stub = stubClient(answering("The criteria are vague."));
      routeOptions = stub.options;

      const res = await ask({ prompt: "Is this epic well specified?", mode: "refine" });
      expect(res.status).toBe(200);

      const prompt = stub.requests[0].prompt;
      expect(prompt).toContain("## Current PRD");
      expect(prompt).toContain("`task-1`");
      expect(prompt).toContain("Original description.");
      expect(prompt).toContain(REFINEMENT_FENCE_TAG);
      // The analysis is still there — refine mode adds the PRD, it does not
      // replace the grounding the panel exists to provide.
      expect(prompt).toContain("checkout-core");
      expect((await res.json()).contextSources).toContain("the PRD");
    });

    it("does not send the PRD or the refine rules for a plain ask", async () => {
      await seedPRD();
      const stub = stubClient(answering("Checkout Core is the weak point."));
      routeOptions = stub.options;

      const res = await ask({ prompt: "Where is the risk?" });
      expect(res.status).toBe(200);

      expect(stub.requests[0].prompt).not.toContain("## Current PRD");
      expect(stub.requests[0].prompt).not.toContain(REFINEMENT_FENCE_TAG);
      const body = await res.json();
      // Absent, not empty: a plain ask has no opinion about the PRD, and an
      // empty list would read as "the model proposed nothing".
      expect(body.proposals).toBeUndefined();
      expect(body.contextSources).not.toContain("the PRD");
    });

    it("returns proposals built against the PRD, and strips the block from the prose", async () => {
      await seedPRD();
      routeOptions = stubClient(answering(withProposals(
        "The criteria do not say what done looks like.",
        [{
          op: "edit",
          itemId: "task-1",
          acceptanceCriteria: ["No file over 400 lines", "Each split module has one owner"],
          rationale: "\"It is smaller\" is not checkable.",
        }],
      ))).options;

      const body = await (await ask({ prompt: "Improve this task.", mode: "refine" })).json();

      expect(body.answer).toBe("The criteria do not say what done looks like.");
      // The JSON is not shown twice: it renders as diffs, and leaving it in the
      // prose would put every change on screen in a form nobody reviews.
      expect(body.answer).not.toContain("acceptanceCriteria");
      expect(body.proposals).toHaveLength(1);
      expect(body.proposals[0].itemId).toBe("task-1");
      // The before side is the server's reading of the item, not the model's.
      expect(body.proposals[0].diffs[0].before).toEqual(["It is smaller"]);
      expect(body.proposals[0].baseline[0].fingerprint).toEqual(expect.any(String));
    });

    it("reports proposals it had to drop rather than silently shrinking the list", async () => {
      await seedPRD();
      routeOptions = stubClient(answering(withProposals("Two ideas.", [
        { op: "edit", itemId: "task-1", priority: "high" },
        { op: "edit", itemId: "does-not-exist", priority: "high" },
      ]))).options;

      const body = await (await ask({ prompt: "Improve this.", mode: "refine" })).json();
      expect(body.proposals).toHaveLength(1);
      expect(body.refinementNotes.join(" ")).toContain("unknown item");
    });

    it("stands in for prose when the model replied with the block alone", async () => {
      await seedPRD();
      routeOptions = stubClient(answering(withProposals("", [
        { op: "edit", itemId: "task-1", priority: "high" },
      ]))).options;

      const res = await ask({ prompt: "Just do it.", mode: "refine" });
      // Not an empty answer — the panel treats one as a provider failure and
      // would throw away proposals that are perfectly good.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.answer).toContain("1 proposed PRD change");
      expect(body.proposals).toHaveLength(1);
    });

    it("names an empty PRD as its own degraded mode, without calling a model", async () => {
      const stub = stubClient(answering("never reached"));
      routeOptions = stub.options;

      const res = await ask({ prompt: "Refine what?", mode: "refine" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.kind).toBe("no_prd");
      expect(body.error).toContain("no PRD items to refine");
      // No tokens are spent asking a model to refine nothing.
      expect(stub.requests).toHaveLength(0);
    });

    it("rejects a mode it does not implement", async () => {
      const res = await ask({ prompt: "Do something else.", mode: "rewrite" });
      expect(res.status).toBe(400);
      expect((await res.json()).kind).toBe("invalid_request");
    });
  });
});
