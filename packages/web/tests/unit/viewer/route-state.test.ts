import { describe, it, expect } from "vitest";
import type { ViewId } from "../../../src/viewer/types.js";
import { parseLegacyHashRoute, parsePathnameRoute, resolveLocationRoute } from "../../../src/viewer/route-state.js";

const VIEWS = new Set<ViewId>([
  "overview",
  "graph",
  "files",
  "routes",
  "architecture",
  "problems",
  "suggestions",
  "pr-markdown",
  "rex-dashboard",
  "token-usage",
  "prd",
  "hench-runs",
]);

describe("route-state", () => {
  it("parses direct PR Markdown hash route", () => {
    expect(parseLegacyHashRoute("#pr-markdown", VIEWS)).toEqual({ view: "pr-markdown", subId: null });
  });

  it("parses SourceVision-prefixed PR Markdown hash route variants", () => {
    expect(parseLegacyHashRoute("#/sourcevision/pr-markdown", VIEWS)).toEqual({ view: "pr-markdown", subId: null });
    expect(parseLegacyHashRoute("#sourcevision:pr_markdown", VIEWS)).toEqual({ view: "pr-markdown", subId: null });
  });

  it("returns null for malformed or unknown PR Markdown hash routes", () => {
    expect(parseLegacyHashRoute("#sourcevision/pr-markdown?tab=raw", VIEWS)).toEqual({ view: "pr-markdown", subId: null });
    expect(parseLegacyHashRoute("#sourcevision/", VIEWS)).toBeNull();
    expect(parseLegacyHashRoute("#sourcevision/pr-markdown/extra", VIEWS)).toBeNull();
    expect(parseLegacyHashRoute("#pr markdown", VIEWS)).toBeNull();
    expect(parseLegacyHashRoute("#missing-tab", VIEWS)).toBeNull();
  });

  it("prefers hash route when both hash and pathname exist", () => {
    const parsed = resolveLocationRoute("/overview", "#pr-markdown", VIEWS);
    expect(parsed).toEqual({ view: "pr-markdown", subId: null });
  });

  it("falls back to pathname route when hash is invalid", () => {
    const parsed = resolveLocationRoute("/pr-markdown", "#not-a-tab", VIEWS);
    expect(parsed).toEqual({ view: "pr-markdown", subId: null });
  });

  it("parses deep-link path routes for PRD and Hench runs", () => {
    expect(parsePathnameRoute("/prd/task-123", VIEWS)).toEqual({ view: "prd", subId: "task-123" });
    expect(parsePathnameRoute("/hench-runs/run-123", VIEWS)).toEqual({ view: "hench-runs", subId: "run-123" });
  });

  it("parses routes served behind the hub's /p/<id>/ base path", () => {
    // Behind the hub the document pathname carries the project prefix; the
    // view is whatever follows it. Deep links must survive the prefix too.
    expect(parsePathnameRoute("/p/alpha/overview", VIEWS)).toEqual({ view: "overview", subId: null });
    expect(parsePathnameRoute("/p/alpha/prd/task-123", VIEWS)).toEqual({ view: "prd", subId: "task-123" });
    expect(parsePathnameRoute("/p/alpha/", VIEWS)).toBeNull(); // project root — default view
    expect(parsePathnameRoute("/p/alpha", VIEWS)).toBeNull();
    // resolveLocationRoute strips uniformly for popstate/boot callers too.
    expect(resolveLocationRoute("/p/alpha/hench-runs/run-9", "", VIEWS)).toEqual({
      view: "hench-runs",
      subId: "run-9",
    });
    // A project id must never leak into view parsing as the view name.
    expect(parsePathnameRoute("/p/overview", VIEWS)).toBeNull();
  });

  it("maps legacy nested rex token usage links to the token-usage view", () => {
    expect(parsePathnameRoute("/rex-dashboard/token-usage", VIEWS)).toEqual({ view: "token-usage", subId: null });
    expect(parseLegacyHashRoute("#rex-dashboard/token_usage", VIEWS)).toEqual({ view: "token-usage", subId: null });
    expect(parseLegacyHashRoute("#/rex/llm-utilization", VIEWS)).toEqual({ view: "token-usage", subId: null });
  });

  it("does not treat non-deep-link views as sub-id routes", () => {
    expect(parsePathnameRoute("/rex-dashboard/some-id", VIEWS)).toBeNull();
    expect(parsePathnameRoute("/token-usage/some-id", VIEWS)).toBeNull();
  });
});
