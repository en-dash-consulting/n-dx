// @vitest-environment jsdom
/**
 * The run-command output panel: terminal colours rendered rather than shown
 * as `[0m` text, and a log that starts at its last three lines.
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  COLLAPSED_LINES,
  RunOutput,
  parseAnsiLines,
} from "../../../src/viewer/components/run-output.js";

describe("parseAnsiLines", () => {
  it("turns colour codes into classes and keeps the text", () => {
    const [line] = parseAnsiLines("\x1b[31merror\x1b[0m: \x1b[1;32mok\x1b[22;39m done");
    expect(line.text).toBe("error: ok done");
    expect(line.segments).toEqual([
      { text: "error", className: "ansi-fg-1" },
      { text: ": ", className: "" },
      { text: "ok", className: "ansi-fg-2 ansi-bold" },
      { text: " done", className: "" },
    ]);
  });

  it("carries a style across lines until it is reset", () => {
    const lines = parseAnsiLines("\x1b[33mone\ntwo\x1b[0m\nthree");
    expect(lines.map((l) => l.segments.map((s) => s.className))).toEqual([
      ["ansi-fg-3"], ["ansi-fg-3"], [""],
    ]);
  });

  it("maps bright colours and basic 256-colour indexes, and drops the rest", () => {
    const [bright] = parseAnsiLines("\x1b[96mcyan");
    expect(bright.segments[0].className).toBe("ansi-fg-14");
    const [indexed] = parseAnsiLines("\x1b[38;5;1mred");
    expect(indexed.segments[0].className).toBe("ansi-fg-1");
    // Truecolor is consumed whole: its numbers must not read as bold (1) or dim (2).
    const [rgb] = parseAnsiLines("\x1b[38;2;1;2;3mplain");
    expect(rgb.segments).toEqual([{ text: "plain", className: "" }]);
  });

  it("drops escapes it cannot render instead of showing them", () => {
    const [line] = parseAnsiLines("\x1b]0;title\x07\x1b[2K\x1b[1Gready\x1b[?25l\x07\x08");
    expect(line.text).toBe("ready");
  });

  it("keeps only the last redraw of a carriage-return progress line", () => {
    const lines = parseAnsiLines("building 10%\rbuilding 50%\rbuilt\r\nnext");
    expect(lines.map((l) => l.text)).toEqual(["built", "next"]);
  });
});

describe("RunOutput", () => {
  let root: HTMLDivElement;

  afterEach(() => {
    render(null, root);
    root.remove();
  });

  async function mount(output: string): Promise<void> {
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(h(RunOutput, { output }), root); });
  }

  const lineTexts = () =>
    [...root.querySelectorAll(".runcmd-line")].map((l) => l.textContent?.replace(/\n$/, ""));

  it("starts collapsed at the last three non-blank lines and expands to the whole log", async () => {
    await mount("one\ntwo\n\nthree\nfour\nfive\n");
    expect(COLLAPSED_LINES).toBe(3);
    expect(lineTexts()).toEqual(["three", "four", "five"]);

    const toggle = root.querySelector<HTMLButtonElement>(".runcmd-output-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Show full log · 5 lines");

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(lineTexts()).toEqual(["one", "two", "", "three", "four", "five"]);

    await act(async () => { toggle.click(); });
    expect(lineTexts()).toEqual(["three", "four", "five"]);
  });

  it("follows new output while collapsed", async () => {
    await mount("a\nb\nc\nd\n");
    await act(async () => { render(h(RunOutput, { output: "a\nb\nc\nd\ne\n" }), root); });
    expect(lineTexts()).toEqual(["c", "d", "e"]);
  });

  it("has no toggle when the whole log already fits", async () => {
    await mount("only\ntwo\n");
    expect(root.querySelector(".runcmd-output-toggle")).toBeNull();
    expect(lineTexts()).toEqual(["only", "two"]);
  });

  it("renders markup in the output as text", async () => {
    await mount("<img src=x onerror=alert(1)>\x1b[31m<b>red</b>\x1b[0m\n");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector(".runcmd-output")?.textContent).toContain("<img src=x onerror=alert(1)><b>red</b>");
  });
});
