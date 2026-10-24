/**
 * Unit tests for parseLmStudioError: the messages it rewrites, the ones it
 * passes through, and that it stays linear in the body. The body is the whole
 * `response.text()` of a failed LM Studio call, read by the provider itself
 * and by hench's local tool loop and verifier, and the model-not-loaded
 * signature used to be cubic in it.
 */

import { describe, it, expect } from "vitest";
import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../lang-kit/tests/helpers/call-within-budget.js";
import { parseLmStudioError } from "../../src/local-api-provider.js";

const PROVIDER = new URL("../../src/local-api-provider.ts", import.meta.url);

const NO_MODEL = "No model loaded in LM Studio — open LM Studio and load a model before running ndx work.";

const lmStudioBody = (message: string): string =>
  JSON.stringify({ error: { message, type: "invalid_request_error", code: "model_not_found" } });

describe("parseLmStudioError", () => {
  describe("model not loaded", () => {
    it.each([
      [lmStudioBody("No model is loaded"), "LM Studio envelope, 'no model is loaded'"],
      [lmStudioBody("No model loaded. Please load a model first."), "LM Studio envelope, 'no model loaded'"],
      [lmStudioBody("Model not found: qwen2.5-coder"), "LM Studio envelope, 'model not found'"],
      [lmStudioBody("The model 'qwen2.5-coder' is not available"), "LM Studio envelope, 'model … not … available'"],
      ["model not found", "bare body"],
      ["Model 'llama-3' is currently not available on this server", "bare body with words between"],
    ])("returns the load-a-model guidance for %j (%s)", (body) => {
      expect(parseLmStudioError(404, body)).toBe(NO_MODEL);
    });

    // The gaps are bounded at 200 characters each because the words of the
    // signature sit within one sentence; a body that mentions a model and,
    // much later, that something is unavailable is not that sentence.
    it.each([
      [`model ${"x".repeat(250)} not available`, "250 characters between model and not"],
      [`model not ${"x".repeat(250)} available`, "250 characters between not and available"],
      ["model\nnot available", "newline between model and not"],
    ])("passes %j through (%s)", (body) => {
      expect(parseLmStudioError(400, body)).toBe(`Local API error 400: ${body}`);
    });
  });

  describe("context-window overflow", () => {
    it("names the requested and configured sizes with the fix", () => {
      const body = lmStudioBody(
        "The number of tokens to keep from the initial prompt is greater than the context length. " +
          "Request (41,837 tokens) exceeds the available context size (4096 tokens).",
      );
      const out = parseLmStudioError(400, body);
      expect(out).toContain(`the brief was ${(41_837).toLocaleString()} tokens`);
      expect(out).toContain(`configured to ${(4096).toLocaleString()} tokens`);
      expect(out).toContain('increase "Context Length" to 32 768 or higher');
    });

    it("reads the sizes from a bare body too", () => {
      const out = parseLmStudioError(400, "request (5000 tokens) exceeds the available context size (2048 tokens)");
      expect(out).toContain(`${(5000).toLocaleString()} tokens`);
      expect(out).toContain(`${(2048).toLocaleString()} tokens`);
    });
  });

  describe("other errors", () => {
    it("prefers error.message from the LM Studio envelope", () => {
      expect(parseLmStudioError(500, lmStudioBody("Something broke"))).toBe("Local API error 500: Something broke");
    });

    it("reads a top-level message", () => {
      expect(parseLmStudioError(503, JSON.stringify({ message: "Server busy" }))).toBe("Local API error 503: Server busy");
    });

    it("keeps a short non-JSON body whole", () => {
      expect(parseLmStudioError(502, "Bad Gateway")).toBe("Local API error 502: Bad Gateway");
    });

    it("truncates a long non-JSON body to 300 characters", () => {
      const body = "y".repeat(1000);
      expect(parseLmStudioError(502, body)).toBe(`Local API error 502: ${"y".repeat(300)}…`);
    });

    it("truncates a JSON body whose shape it does not know", () => {
      const body = JSON.stringify({ detail: "z".repeat(1000) });
      expect(parseLmStudioError(422, body)).toBe(`Local API error 422: ${body.slice(0, 300)}…`);
    });
  });

  // The 300-character truncation above runs after the signature tests, so the
  // body reaches them whole. The call runs under lang-kit's callWithinBudget: a
  // regressed pattern blocks the thread it matches on, where vitest's per-test
  // timeout never fires, and the helper fails the test by name instead.
  describe("on pathological input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
    it("is linear on 'model not ' repeated with no 'available'", async () => {
      const body = "model not ".repeat(2000);
      await expect(callWithinBudget<typeof parseLmStudioError>(PROVIDER, "parseLmStudioError", 500, body)).resolves.toBe(
        `Local API error 500: ${body.slice(0, 300)}…`,
      );
    });

    it("is linear on an LM Studio envelope whose message repeats 'model not '", async () => {
      const body = lmStudioBody("model not ".repeat(2000));
      await expect(callWithinBudget<typeof parseLmStudioError>(PROVIDER, "parseLmStudioError", 500, body)).resolves.toBe(
        `Local API error 500: ${"model not ".repeat(2000)}`,
      );
    });

    it("still reads a signature at the head of a long body", async () => {
      const body = `No model is loaded. ${"x".repeat(100_000)}`;
      await expect(callWithinBudget<typeof parseLmStudioError>(PROVIDER, "parseLmStudioError", 404, body)).resolves.toBe(NO_MODEL);
    });
  });
});
