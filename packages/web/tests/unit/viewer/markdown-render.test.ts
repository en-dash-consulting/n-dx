// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { renderMarkdown } from "../../../src/viewer/utils/markdown.js";
import { SidecarFrameRow } from "../../../src/viewer/components/sidecar-drawer.js";

let host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); });
afterEach(() => { render(null, host); host.remove(); });

function reply(text: string): HTMLElement {
  act(() => {
    render(h("ul", null, h(SidecarFrameRow, {
      frame: { seq: 1, at: "t", type: "event", event: { type: "assistant", text } },
    })), host);
  });
  return host.querySelector(".sidecar-msg-assistant") as HTMLElement;
}

describe("Sidecar reply markdown", () => {
  it("renders headings, lists, fenced and inline code, bold and links", () => {
    const row = reply([
      "# Title", "", "- one", "- two", "", "1. first", "", "```ts", "const x = 1;", "```", "",
      "Use `foo` and **bold** and *soft* with [docs](https://example.com/a).",
    ].join("\n"));
    expect(row.querySelector("h1")?.textContent).toBe("Title");
    expect(row.querySelectorAll("ul.sidecar-md-list li")).toHaveLength(2);
    expect(row.querySelectorAll("ol.sidecar-md-list li")).toHaveLength(1);
    expect(row.querySelector("pre code")?.textContent).toBe("const x = 1;");
    expect(row.querySelector("p code")?.textContent).toBe("foo");
    expect(row.querySelector("strong")?.textContent).toBe("bold");
    expect(row.querySelector("em")?.textContent).toBe("soft");
    const a = row.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/a");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("continues a numbered list split by a code fence", () => {
    const row = reply(["1. Install", "", "```sh", "pnpm i", "```", "", "2. Run"].join("\n"));
    const lists = row.querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect(lists[0].hasAttribute("start")).toBe(false);
    expect(lists[1].getAttribute("start")).toBe("2");
  });

  it("renders indented sub-bullets as list items, not literal text", () => {
    const row = reply(["- parent", "  - detail", "    * deeper"].join("\n"));
    expect(row.querySelectorAll("ul.sidecar-md-list li")).toHaveLength(3);
    expect(row.querySelector("p")).toBeNull();
    expect(row.textContent).not.toContain("- detail");
  });

  it("renders raw HTML as text", () => {
    const row = reply('<img src=x onerror="alert(1)"> <script>boom()</script>');
    expect(row.querySelector("img, script")).toBeNull();
    expect(row.textContent).toContain("<script>boom()</script>");
  });

  it("does not link unsafe schemes", () => {
    const row = reply("[x](javascript:alert(1))");
    expect(row.querySelector("a")).toBeNull();
    expect(row.textContent).toContain("javascript:alert(1)");
  });

  it("leaves incomplete streaming markup literal", () => {
    const row = reply("Half **bold and `code and [lin");
    expect(row.querySelector("strong, code, a")).toBeNull();
    expect(row.textContent).toBe("Half **bold and `code and [lin");
  });

  it("shows each single-newline line of a paragraph on its own line", () => {
    const row = reply("Done.\nRun `ndx work` next.\nThen check Live.");
    expect(row.querySelectorAll("p")).toHaveLength(1);
    expect(row.querySelectorAll("p br")).toHaveLength(2);
    expect(row.querySelector("p")?.innerHTML).toBe("Done.<br>Run <code>ndx work</code> next.<br>Then check Live.");
  });

  it("renders an unclosed fence as the code so far", () => {
    expect(reply("```\nconst a").querySelector("pre code")?.textContent).toBe("const a");
  });
});

describe("PR preview rendering", () => {
  it("keeps the pr-markdown-preview class names", () => {
    act(() => {
      render(h("div", null, renderMarkdown("# H\n\npara one\nline two\n\n- a\n\n```\nx\n```", { classPrefix: "pr-markdown-preview" })), host);
    });
    expect(host.querySelector("h1.pr-markdown-preview-heading")).not.toBeNull();
    expect(host.querySelector("p.pr-markdown-preview-paragraph")?.textContent).toBe("para one line two");
    expect(host.querySelector("ul.pr-markdown-preview-list li")?.textContent).toBe("a");
    expect(host.querySelector("pre.pr-markdown-preview-code")).not.toBeNull();
  });
});
