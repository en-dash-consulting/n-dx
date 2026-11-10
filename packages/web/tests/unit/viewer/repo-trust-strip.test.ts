// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { buildTrustNotice, RepoTrustStrip, type RepoTrustView } from "../../../src/viewer/components/repo-trust-strip.js";

const UNTRUSTED: RepoTrustView = {
  state: "untrusted",
  restricted: true,
  sources: [".hench/config.json", ".mcp.json"],
  findings: [
    { code: "commands-added", severity: "warning", message: "Allows the agent to run commands outside the typescript baseline: bash, curl", values: ["bash", "curl"] },
    { code: "test-command", severity: "info", message: "Defines the test command n-dx runs for verification: pnpm test", values: ["pnpm test"] },
  ],
};

describe("buildTrustNotice", () => {
  it("is null when there is nothing to show", () => {
    expect(buildTrustNotice(null)).toBeNull();
    expect(buildTrustNotice({ ...UNTRUSTED, state: "trusted", restricted: false })).toBeNull();
    expect(buildTrustNotice({ ...UNTRUSTED, state: "baseline", restricted: false, findings: [] })).toBeNull();
  });

  it("counts warnings, names the sources, and separates infos", () => {
    const notice = buildTrustNotice(UNTRUSTED)!;
    expect(notice.headline).toBe("This repository's execution config is not trusted");
    expect(notice.detail).toContain("1 finding (.hench/config.json, .mcp.json)");
    expect(notice.detail).toContain("restricted until trusted");
    expect(notice.restrictions).toContain("default guard");
    expect(notice.warnings).toHaveLength(1);
    expect(notice.infos).toEqual(["Defines the test command n-dx runs for verification: pnpm test"]);
  });

  it("keeps the visible text short with 300 PRD sources", () => {
    const sources = [".n-dx.json", ".hench/config.json", ...Array.from({ length: 300 }, (_, i) => `.rex/changes/some-long-change-slug-${i}/task-${i}.md`)];
    const notice = buildTrustNotice({ ...UNTRUSTED, sources })!;
    expect(notice.headline.length + notice.detail.length).toBeLessThan(260);
    expect(notice.detail).toContain("+299 more");
    expect(notice.sources).toHaveLength(50);
    expect(notice.moreSources).toBe(252);
  });

  it("keeps the visible text under the cap with long source names and many findings", () => {
    const sources = Array.from({ length: 9999 }, (_, i) => `${"very-long-directory-name/".repeat(5)}item-${i}.md`);
    const finding = UNTRUSTED.findings[0]!;
    const findings = Array.from({ length: 99 }, () => finding);
    const notice = buildTrustNotice({ ...UNTRUSTED, state: "changed", sources, findings })!;
    expect(notice.headline.length + notice.detail.length).toBeLessThan(260);
    expect(notice.detail).toContain("99 findings");
    expect(notice.detail).toMatch(/\+\d+ more\)/);
  });

  it("shows the PRD item count when three config files come first", () => {
    const sources = [".hench/config.json", ".n-dx.json", ".mcp.json", ".rex/changes/"];
    const notice = buildTrustNotice({ ...UNTRUSTED, sources, prdRunBlocks: 214, prdRunBlocksPath: ".rex/changes/" })!;
    expect(notice.detail).toContain("(.hench/config.json, .n-dx.json, .mcp.json) and 214 PRD items with saved run settings");
    expect(notice.detail).not.toContain("more");
    expect(notice.sources).toEqual([".hench/config.json", ".n-dx.json", ".mcp.json", ".rex/changes/ (214 PRD items with saved run settings)"]);
    expect(notice.headline.length + notice.detail.length).toBeLessThan(260);
  });

  it("leaves out only the entry the server names as the PRD path", () => {
    const sources = [".rex/", ".rex/changes/", ".a"];
    const notice = buildTrustNotice({ ...UNTRUSTED, sources, prdRunBlocks: 2, prdRunBlocksPath: ".rex/changes/" })!;
    expect(notice.detail).toContain("(.rex/, .a) and 2 PRD items with saved run settings");
  });

  it("keeps this repo's visible text near two lines and the restrictions under Details", () => {
    const sources = [".hench/config.json", ".n-dx.json", ".mcp.json", ".rex/changes/", ".claude/settings.json", ".codex/config.toml"];
    const view = { ...UNTRUSTED, sources, prdRunBlocks: 177, prdRunBlocksPath: ".rex/changes/" };
    const notice = buildTrustNotice(view)!;
    expect(notice.detail).toContain("177 PRD items");
    expect(notice.detail).not.toContain(".rex/changes/");
    expect(notice.headline.length + notice.detail.length).toBeLessThanOrEqual(220);
    expect(notice.detail).not.toContain("bypassPermissions");
    const root = document.createElement("div");
    document.body.appendChild(root);
    act(() => { render(h(RepoTrustStrip, { initial: view }), root); });
    expect(root.textContent).not.toContain("bypassPermissions");
    act(() => { Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Details")!.click(); });
    const details = root.querySelector(".repo-trust-strip__details")!;
    expect(details.firstElementChild!.textContent).toContain("bypassPermissions is lowered to acceptEdits");
  });

  it("keeps the PRD count under the cap with long source names", () => {
    const long = Array.from({ length: 3 }, (_, i) => `${"very-long-directory-name/".repeat(5)}c${i}.json`);
    const sources = [...long, ".rex/changes/"];
    const notice = buildTrustNotice({ ...UNTRUSTED, state: "changed", sources, prdRunBlocks: 99999, prdRunBlocksPath: ".rex/changes/" })!;
    expect(notice.detail).toContain("99999 PRD items");
    expect(notice.headline.length + notice.detail.length).toBeLessThan(260);
  });

  it("behaves as before when an older server sends no count", () => {
    const sources = [".a", ".b", ".c", ".rex/changes/"];
    expect(buildTrustNotice({ ...UNTRUSTED, sources })!.detail).toContain("(.a, .b, .c, +1 more)");
  });

  it("says changed when the record is for another digest", () => {
    expect(buildTrustNotice({ ...UNTRUSTED, state: "changed" })!.headline).toContain("changed since you trusted it");
  });
});

describe("RepoTrustStrip", () => {
  function mount(initial: RepoTrustView | null, fetchImpl?: typeof fetch): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    act(() => { render(h(RepoTrustStrip, { initial, fetchImpl }), root); });
    return root;
  }

  it("renders nothing for a trusted repository", () => {
    const root = mount({ ...UNTRUSTED, state: "trusted", restricted: false });
    expect(root.querySelector(".repo-trust-strip")).toBeNull();
  });

  it("renders the headline, toggles the details, and hides on Not now", () => {
    const root = mount(UNTRUSTED);
    const strip = root.querySelector(".repo-trust-strip")!;
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain("not trusted");
    expect(root.querySelector(".repo-trust-strip__list")).toBeNull();

    const buttons = Array.from(root.querySelectorAll("button"));
    act(() => { buttons.find((b) => b.textContent === "Details")!.click(); });
    expect(root.querySelectorAll(".repo-trust-strip__list li")).toHaveLength(2);

    act(() => { Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Not now")!.click(); });
    expect(root.querySelector(".repo-trust-strip")).toBeNull();
  });

  it("lists sources only once Details is open", () => {
    const sources = Array.from({ length: 300 }, (_, i) => `.rex/prd-item-${i}.md`);
    const root = mount({ ...UNTRUSTED, sources });
    expect(root.querySelector(".repo-trust-strip__source")).toBeNull();
    expect(root.textContent).not.toContain("prd-item-100.md");
    act(() => { Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Details")!.click(); });
    expect(root.querySelectorAll(".repo-trust-strip__source")).toHaveLength(51);
    expect(root.textContent).toContain("+250 more");
  });

  it("posts to accept and disappears when the server reports trusted", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ ...UNTRUSTED, state: "trusted", restricted: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const root = mount(UNTRUSTED, fetchImpl);
    const accept = Array.from(root.querySelectorAll("button")).find((b) => b.textContent === "Trust this configuration")!;
    await act(async () => {
      accept.click();
      // fetch → json → setState: let the microtask chain drain.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(calls).toEqual([{ url: "/api/trust/accept", method: "POST" }]);
    expect(root.querySelector(".repo-trust-strip")).toBeNull();
  });
});
