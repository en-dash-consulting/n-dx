// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { GlossaryLine } from "../../../src/viewer/components/glossary-line.js";
import { getGlossaryDefinition } from "../../../src/shared/glossary.js";

describe("GlossaryLine", () => {
  let root: HTMLDivElement;

  function renderLine(term: string) {
    root = document.createElement("div");
    document.body.appendChild(root);
    act(() => {
      render(h(GlossaryLine, { term }), root);
    });
  }

  it("renders the glossary definition for a known term", () => {
    renderLine("zone");
    expect(root.textContent).toBe(getGlossaryDefinition("zone"));
    expect(root.querySelector(".glossary-line")).not.toBeNull();
  });

  it("renders nothing for a term the glossary does not define", () => {
    renderLine("not-a-real-term");
    expect(root.textContent).toBe("");
    expect(root.querySelector(".glossary-line")).toBeNull();
  });
});
