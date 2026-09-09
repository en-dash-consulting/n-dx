/**
 * Unit tests for POST /api/sourcevision/ask.
 *
 * The endpoint answers a question about the analyzed project, grounded in the
 * `.sourcevision/` artifacts rather than the model's own recollection of the
 * codebase. Three properties matter enough to pin:
 *
 * 1. **The context actually reaches the model.** An endpoint that reads
 *    CONTEXT.md and then forgets to include it would still return plausible
 *    prose — the failure is invisible from the response alone, so the test
 *    asserts on the prompt handed to `complete()`.
 * 2. **The vendor and model are resolved from config, not hardcoded**, and are
 *    reported back. A caller cannot judge an answer without knowing what
 *    produced it.
 * 3. **Failures are named.** `ClaudeClientError` already classifies auth,
 *    timeout, rate-limit and CLI failures; a route that collapses them into a
 *    500 throws that away, and "it hung" and "you are rate limited" need
 *    different responses from the operator.
 *
 * @see packages/web/src/server/routes-sourcevision-ask.ts
 * @see packages/web/src/server/sourcevision-ask-context.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const { completeMock, createLLMClientMock, loadLLMConfigMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  createLLMClientMock: vi.fn(),
  loadLLMConfigMock: vi.fn(),
}));

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...actual,
    createLLMClient: createLLMClientMock,
    loadLLMConfig: loadLLMConfigMock,
  };
});

import { ClaudeClientError } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleSourcevisionAskRoute } from "../../../src/server/routes-sourcevision-ask.js";
import { readAskUsage } from "../../../src/server/ask-usage-log.js";
import {
  startRouteTestServer,
  closeRouteTestServer,
} from "../../helpers/server-route-test-support.js";

const CONTEXT_MD = [
  "# Project Context",
  "",
  "## Zones",
  "- `billing` — 12 files, cohesion 0.91. Invoice generation and dunning.",
  "- `api` — 8 files, cohesion 0.88. HTTP handlers.",
].join("\n");

describe("POST /api/sourcevision/ask", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    completeMock.mockReset();
    createLLMClientMock.mockReset();
    loadLLMConfigMock.mockReset();

    createLLMClientMock.mockReturnValue({ mode: "cli", complete: completeMock });
    loadLLMConfigMock.mockResolvedValue({ vendor: "claude", claude: { model: "claude-sonnet-5" } });
    completeMock.mockResolvedValue({
      text: "The billing zone owns invoice generation.",
      tokenUsage: { input: 1200, output: 42 },
    });

    tmpDir = await mkdtemp(join(tmpdir(), "sv-ask-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await writeFile(join(tmpDir, ".sourcevision", "CONTEXT.md"), CONTEXT_MD, "utf-8");

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    } as ServerContext;

    const started = await startRouteTestServer((req, res) =>
      handleSourcevisionAskRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** POST a body to the ask endpoint. */
  async function ask(body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/sourcevision/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  // ── Success path ──────────────────────────────────────────────────────────

  it("answers, and reports the vendor and model that produced the answer", async () => {
    const { status, body } = await ask({ prompt: "What does the billing zone do?" });

    expect(status).toBe(200);
    expect(body.answer).toBe("The billing zone owns invoice generation.");
    expect(body.vendor).toBe("claude");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.tokens).toEqual({ input: 1200, output: 42 });
  });

  it("grounds the answer in .sourcevision/ data", async () => {
    // The property the endpoint exists for. Asserted on the prompt rather than
    // the response, because a route that dropped the context would still
    // return fluent text.
    await ask({ prompt: "What does the billing zone do?" });

    const prompt = completeMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Invoice generation and dunning");
    expect(prompt).toContain("What does the billing zone do?");
    expect(prompt).toContain("cohesion 0.91");
  });

  it("includes the caller's seed context when supplied", async () => {
    await ask({ prompt: "Why does this matter?", seed: "Finding: api imports billing directly." });

    const prompt = completeMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("api imports billing directly");
  });

  it("resolves the model from config rather than hardcoding it", async () => {
    loadLLMConfigMock.mockResolvedValue({ vendor: "claude", claude: { model: "claude-opus-5" } });

    const { body } = await ask({ prompt: "Anything." });

    expect(completeMock.mock.calls[0][0].model).toBe("claude-opus-5");
    expect(body.model).toBe("claude-opus-5");
  });

  // ── Request validation ────────────────────────────────────────────────────

  it("rejects a missing prompt with 400", async () => {
    const { status, body } = await ask({});
    expect(status).toBe(400);
    expect(body.error).toMatch(/prompt/i);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("rejects a blank prompt with 400", async () => {
    const { status } = await ask({ prompt: "   " });
    expect(status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string seed with 400", async () => {
    const { status } = await ask({ prompt: "ok", seed: { not: "a string" } });
    expect(status).toBe(400);
    expect(completeMock).not.toHaveBeenCalled();
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  it("returns 504 and names the timeout", async () => {
    completeMock.mockRejectedValue(new ClaudeClientError("took too long", "timeout", true));

    const { status, body } = await ask({ prompt: "Anything." });

    expect(status).toBe(504);
    expect(body.reason).toBe("timeout");
    expect(body.error).toMatch(/timed out/i);
  });

  it("returns 429 and names the rate limit", async () => {
    completeMock.mockRejectedValue(new ClaudeClientError("slow down", "rate-limit", true));

    const { status, body } = await ask({ prompt: "Anything." });

    expect(status).toBe(429);
    expect(body.reason).toBe("rate-limit");
    expect(body.error).toMatch(/rate limit/i);
  });

  it("returns 401 and names the auth failure", async () => {
    completeMock.mockRejectedValue(new ClaudeClientError("not logged in", "auth", false));

    const { status, body } = await ask({ prompt: "Anything." });

    expect(status).toBe(401);
    expect(body.reason).toBe("auth");
  });

  it("names an unclassified failure rather than surfacing a bare 500", async () => {
    completeMock.mockRejectedValue(new Error("socket hang up"));

    const { status, body } = await ask({ prompt: "Anything." });

    expect(status).toBe(502);
    expect(body.reason).toBe("unknown");
    expect(body.error).toMatch(/socket hang up/);
  });

  it("returns 409 when the project has not been analyzed", async () => {
    // No CONTEXT.md means there is no ground truth to answer from. Saying so
    // is more useful than letting the model answer from imagination.
    await rm(join(tmpDir, ".sourcevision", "CONTEXT.md"));

    const { status, body } = await ask({ prompt: "Anything." });

    expect(status).toBe(409);
    expect(body.error).toMatch(/analy/i);
    expect(completeMock).not.toHaveBeenCalled();
  });

  // ── Explaining a finding ──────────────────────────────────────────────────

  /**
   * The finding arrives as named fields, which is the point: an explanation
   * that could have been written without reading this repository is a failed
   * explanation, and the zone and files are what make that impossible. Asserted
   * on the prompt handed to the model, because a route that accepted the
   * finding and forgot to include it would still return fluent prose.
   */
  describe("structured finding seed", () => {
    const FINDING = {
      type: "anti-pattern",
      severity: "critical",
      zone: "billing",
      message: "High coupling between billing and api",
      files: ["src/billing/invoice.ts", "src/api/handlers.ts"],
    };

    /** The prompt text handed to the model on the most recent call. */
    function lastPrompt(): string {
      return completeMock.mock.calls.at(-1)![0].prompt as string;
    }

    it("puts the finding's zone, files and message in front of the model", async () => {
      const { status } = await ask({ prompt: "Explain this.", finding: FINDING });

      expect(status).toBe(200);
      const prompt = lastPrompt();
      expect(prompt).toContain("zone: billing");
      expect(prompt).toContain("src/billing/invoice.ts");
      expect(prompt).toContain("src/api/handlers.ts");
      expect(prompt).toContain("High coupling between billing and api");
      expect(prompt).toContain("type: anti-pattern");
      expect(prompt).toContain("severity: critical");
    });

    it("keeps the finding alongside the analysis, not instead of it", async () => {
      await ask({ prompt: "Explain this.", finding: FINDING });

      // Grounding is what lets the answer say something true about `billing`
      // rather than about coupling in general.
      const prompt = lastPrompt();
      expect(prompt).toContain("Invoice generation and dunning");
      expect(prompt.indexOf("Invoice generation")).toBeLessThan(prompt.indexOf("the finding to explain"));
    });

    it("reports the finding as a source of the answer", async () => {
      const { body } = await ask({ prompt: "Explain this.", finding: FINDING });

      expect(body.sources).toContain("CONTEXT.md");
      expect(body.sources).toContain("finding");
    });

    it("omits severity the analysis never set rather than defaulting it", async () => {
      const { severity: _omitted, ...unclassified } = FINDING;
      await ask({ prompt: "Explain this.", finding: unclassified });

      // "severity: info" would be the route asserting a classification the
      // analysis declined to make.
      expect(lastPrompt()).not.toContain("severity:");
      expect(lastPrompt()).toContain("zone: billing");
    });

    it("says so plainly when a finding names no files", async () => {
      await ask({ prompt: "Explain this.", finding: { ...FINDING, files: [] } });

      // An empty list would read as a truncated line; this cannot be mistaken
      // for a filename.
      expect(lastPrompt()).toContain("files: (none recorded)");
    });

    it("still answers a plain question with no finding attached", async () => {
      const { status, body } = await ask({ prompt: "What does the billing zone do?" });

      expect(status).toBe(200);
      expect(body.sources).not.toContain("finding");
      expect(lastPrompt()).not.toContain("the finding to explain");
    });

    it("carries a free-text seed and a finding together", async () => {
      await ask({ prompt: "Explain this.", finding: FINDING, seed: "The user is new to this repo." });

      expect(lastPrompt()).toContain("zone: billing");
      expect(lastPrompt()).toContain("The user is new to this repo.");
    });

    // ── Validation ───────────────────────────────────────────────────────────

    it("rejects a finding that is not an object", async () => {
      const { status, body } = await ask({ prompt: "Explain.", finding: "billing coupling" });

      expect(status).toBe(400);
      expect(body.error).toMatch(/finding/i);
      expect(completeMock).not.toHaveBeenCalled();
    });

    it("rejects a finding missing a required field", async () => {
      for (const field of ["type", "zone", "message"]) {
        completeMock.mockClear();
        const partial: Record<string, unknown> = { ...FINDING };
        delete partial[field];

        const { status, body } = await ask({ prompt: "Explain.", finding: partial });

        expect(status, `missing ${field}`).toBe(400);
        expect(body.error).toContain(`finding.${field}`);
        expect(completeMock).not.toHaveBeenCalled();
      }
    });

    it("rejects a files list that is not strings", async () => {
      // Numbers would reach the prompt as "1, 2" and read as filenames.
      const { status, body } = await ask({ prompt: "Explain.", finding: { ...FINDING, files: [1, 2] } });

      expect(status).toBe(400);
      expect(body.error).toContain("finding.files");
      expect(completeMock).not.toHaveBeenCalled();
    });

    it("accepts a finding that omits files entirely", async () => {
      const { files: _omitted, ...noFiles } = FINDING;
      const { status } = await ask({ prompt: "Explain.", finding: noFiles });

      expect(status).toBe(200);
      expect(lastPrompt()).toContain("files: (none recorded)");
    });
  });

  // ── Token accounting ──────────────────────────────────────────────────────

  /**
   * An ask is the one place n-dx spends tokens interactively, and it spent them
   * with no trace until this log existed — invisible in the very view that
   * reports token usage. What matters is that the record carries enough to
   * attribute the spend (vendor, model, every counter) and that it is written
   * whether or not the answer arrived.
   */
  describe("records its spend", () => {
    it("records vendor, model, and every token counter for a successful ask", async () => {
      completeMock.mockResolvedValue({
        text: "An answer.",
        tokenUsage: { input: 1200, output: 42, cacheCreationInput: 300, cacheReadInput: 900 },
      });

      await ask({ prompt: "What does the billing zone do?" });

      const entries = await readAskUsage(join(tmpDir, ".sourcevision"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        vendor: "claude",
        model: "claude-sonnet-5",
        inputTokens: 1200,
        outputTokens: 42,
        cacheCreationTokens: 300,
        cacheReadTokens: 900,
        ok: true,
      });
      expect(Date.parse(entries[0]!.timestamp)).not.toBeNaN();
    });

    it("attributes the spend to the model that actually answered", async () => {
      loadLLMConfigMock.mockResolvedValue({ vendor: "claude", claude: { model: "claude-opus-5" } });

      await ask({ prompt: "Anything." });

      const entries = await readAskUsage(join(tmpDir, ".sourcevision"));
      expect(entries[0]!.model).toBe("claude-opus-5");
    });

    it("records a failed ask as a call that happened, with its reason", async () => {
      completeMock.mockRejectedValue(new ClaudeClientError("timed out", "timeout", true));

      const { status } = await ask({ prompt: "Anything." });
      expect(status).toBe(504);

      // Dropping the failure would make a run of timeouts look free.
      const entries = await readAskUsage(join(tmpDir, ".sourcevision"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ ok: false, reason: "timeout", vendor: "claude" });
    });

    it("records the tokens a failed call reports, when it reports any", async () => {
      // No provider attaches usage to a thrown error today; the route reads it
      // defensively so that a provider which starts to does not need a change
      // here to be counted.
      const err = Object.assign(new ClaudeClientError("died mid-stream", "cli", false), {
        tokenUsage: { input: 800, output: 0, cacheReadInput: 120 },
      });
      completeMock.mockRejectedValue(err);

      await ask({ prompt: "Anything." });

      const entries = await readAskUsage(join(tmpDir, ".sourcevision"));
      expect(entries[0]).toMatchObject({
        ok: false, inputTokens: 800, cacheReadTokens: 120,
      });
    });

    it("records zeros rather than nothing when a provider reports no usage", async () => {
      completeMock.mockResolvedValue({ text: "An answer." });

      await ask({ prompt: "Anything." });

      const entries = await readAskUsage(join(tmpDir, ".sourcevision"));
      expect(entries[0]).toMatchObject({
        inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, ok: true,
      });
    });

    it("still answers when the spend cannot be recorded", async () => {
      // The log lives in .sourcevision/, which the request handler does not
      // create. If it is gone, the answer must still reach the user.
      await rm(join(tmpDir, ".sourcevision", "CONTEXT.md"));
      const contextSource = {
        assemble: async () => ({ text: "Zones: billing.", sources: ["CONTEXT.md"] }),
      };
      const isolated = await startRouteTestServer((req, res) =>
        handleSourcevisionAskRoute(req, res, { ...ctx, svDir: join(tmpDir, "gone") }, contextSource),
      );
      try {
        const res = await fetch(`http://127.0.0.1:${isolated.port}/api/sourcevision/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "Anything." }),
        });
        const body = await res.json() as { ok: boolean; answer: string };
        expect(res.status).toBe(200);
        expect(body.answer).toBe("The billing zone owns invoice generation.");
      } finally {
        await closeRouteTestServer(isolated.server);
      }
    });

    it("writes nothing for a request that never reached the model", async () => {
      await ask({});
      await ask({ prompt: "   " });

      expect(await readAskUsage(join(tmpDir, ".sourcevision"))).toEqual([]);
    });
  });

  // ── Routing ───────────────────────────────────────────────────────────────

  it("ignores unrelated paths", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/other`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("rejects GET on the ask path with 405", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sourcevision/ask`);
    expect(res.status).toBe(405);
  });
});
