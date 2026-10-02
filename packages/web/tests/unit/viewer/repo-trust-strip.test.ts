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
    expect(notice.detail).toContain("default guard");
    expect(notice.warnings).toHaveLength(1);
    expect(notice.infos).toEqual(["Defines the test command n-dx runs for verification: pnpm test"]);
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
