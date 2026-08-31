/**
 * Interaction regression tests for the rendered isometric map.
 *
 * These run the generated page's own script in jsdom and drive it with the
 * event sequence a real browser produces. An earlier version listened on both
 * `pointerup` and `click` while `select()` toggled, so a single physical click
 * fired twice and deselected immediately — the map looked completely inert.
 * Dispatching only `click` did not reproduce it, which is exactly why these
 * tests dispatch the real pair.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { JSDOM } from "jsdom";
import { buildIsoModel } from "../../../src/export/iso-model.js";
import { renderIsoMap } from "../../../src/export/iso-map.js";
import type { IsoFileInput, IsoModelInput } from "../../../src/export/iso-model.js";

function makeInput(over: Partial<IsoModelInput> = {}): IsoModelInput {
  return {
    zones: [
      {
        id: "api", name: "Api", description: "HTTP surface",
        files: ["src/api/a.ts", "src/api/b.ts"], entryPoints: ["src/api/a.ts"],
        cohesion: 0.8, coupling: 0.2,
      },
      {
        id: "core", name: "Core", description: "Business logic",
        files: ["src/core/c.ts", "src/core/d.ts", "src/core/e.ts"],
        entryPoints: ["src/core/c.ts"], cohesion: 0.7, coupling: 0.3,
      },
      {
        id: "db", name: "Db", description: "Persistence",
        files: ["src/db/f.ts"], entryPoints: ["src/db/f.ts"],
        cohesion: 0.9, coupling: 0.1,
      },
    ],
    crossings: [
      { fromZone: "api", toZone: "core" },
      { fromZone: "core", toZone: "db" },
    ],
    files: new Map<string, IsoFileInput>([
      ["src/api/a.ts", { lineCount: 100, kind: "entry" }],
      ["src/api/b.ts", { lineCount: 50, kind: "entry" }],
      ["src/core/c.ts", { lineCount: 400, kind: "logic" }],
      ["src/core/d.ts", { lineCount: 300, kind: "logic" }],
      ["src/core/e.ts", { lineCount: 200, kind: "support" }],
      ["src/db/f.ts", { lineCount: 20, kind: "data" }],
    ]),
    external: [],
    findings: [],
    meta: {
      project: "interaction-fixture", analyzedAt: "2026-01-01T00:00:00.000Z",
      origin: "sourcevision", totalFiles: 6, totalLines: 1070,
    },
    ...over,
  };
}

/** The pair of events a browser fires for one physical click. */
function realClick(win: JSDOM["window"], element: Element): void {
  element.dispatchEvent(new win.Event("pointerup", { bubbles: true }));
  element.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
}

function mount(input: IsoModelInput): JSDOM {
  return new JSDOM(renderIsoMap(buildIsoModel(input)), { runScripts: "dangerously" });
}

describe("iso map interaction", () => {
  let dom: JSDOM;
  let doc: Document;
  let win: JSDOM["window"];

  const heading = () => doc.querySelector("#dossier h3")?.textContent ?? "";
  const panel = () => doc.querySelector("#dossier")!.innerHTML;
  const blocks = () => [...doc.querySelectorAll("#iso .node[role=button]")];
  const edges = () => [...doc.querySelectorAll("#iso .edge")];
  const block = (name: string) =>
    blocks().find((b) => (b.getAttribute("aria-label") ?? "").startsWith(name))!;

  beforeAll(() => {
    dom = mount(makeInput());
    doc = dom.window.document;
    win = dom.window;
  });

  afterAll(() => dom.window.close());

  it("builds a block per zone and a connector per edge", () => {
    expect(blocks()).toHaveLength(3);
    expect(edges()).toHaveLength(2);
  });

  it("shows the overview before anything is selected", () => {
    expect(heading()).toBe("interaction-fixture");
  });

  it("selects a zone on a real click — the pointerup+click pair", () => {
    realClick(win, block("Core"));
    expect(heading()).toBe("Core");
  });

  it("keeps the zone selected when the same block is clicked again", () => {
    realClick(win, block("Core"));
    realClick(win, block("Core"));
    expect(heading()).toBe("Core");
  });

  it("moves the selection between blocks", () => {
    realClick(win, block("Core"));
    realClick(win, block("Api"));
    expect(heading()).toBe("Api");
  });

  it("shows the zone's files, metrics and dependencies", () => {
    realClick(win, block("Core"));
    expect(panel()).toContain("src/core/c.ts");
    expect(panel()).toContain("Imported by");
    expect(panel()).toContain("Imports");
    expect(panel()).toContain("cohesion");
  });

  it("selects a dependency when its connector is clicked", () => {
    realClick(win, edges()[0]);
    expect(heading()).toMatch(/→/);
    expect(panel()).toContain("cross-zone import");
  });

  it("gives every connector a widened transparent hit target", () => {
    for (const edge of edges()) {
      const hit = edge.querySelector("polyline")!;
      expect(hit.getAttribute("stroke")).toBe("transparent");
      expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
    }
  });

  it("navigates to a zone from a link in the panel", () => {
    realClick(win, block("Api"));
    const link = doc.querySelector("#dossier [data-goto]") as HTMLElement;
    link.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(heading()).not.toBe("Api");
  });

  it("opens a dependency from the reference count in a zone panel", () => {
    realClick(win, block("Core"));
    const wire = doc.querySelector("#dossier [data-edge]") as HTMLElement;
    expect(wire).not.toBeNull();
    wire.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(heading()).toMatch(/→/);
  });

  it("clears the selection on Escape", () => {
    realClick(win, blocks()[0]);
    expect(heading()).not.toBe("interaction-fixture");
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(heading()).toBe("interaction-fixture");
  });

  it("toggles a legend filter without disturbing the selection", () => {
    realClick(win, block("Core"));
    const legend = doc.querySelector('.lg[data-kind="support"]') as HTMLElement;
    legend.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    expect(legend.getAttribute("aria-pressed")).toBe("true");
    expect(heading()).toBe("Core");
  });

  it("raises no script errors while loading and interacting", () => {
    const errors: string[] = [];
    win.addEventListener("error", (e) => errors.push(String((e as ErrorEvent).message)));
    realClick(win, blocks()[0]);
    realClick(win, edges()[0]);
    expect(errors).toEqual([]);
  });
});

// ── Accessibility ───────────────────────────────────────────────────────────

describe("iso map accessibility", () => {
  let dom: JSDOM;
  let doc: Document;

  beforeAll(() => {
    dom = mount(makeInput());
    doc = dom.window.document;
  });
  afterAll(() => dom.window.close());

  it("keeps connectors out of the tab order", () => {
    // A real map has hundreds of edges; tabbing through them all would bury the
    // blocks. Every edge stays reachable from either zone's panel instead.
    for (const edge of doc.querySelectorAll("#iso .edge")) {
      expect(edge.getAttribute("tabindex")).toBe("-1");
    }
    const tabbable = doc.querySelectorAll('#iso [tabindex="0"]');
    expect(tabbable.length).toBe(3); // one per zone, nothing else
  });

  it("gives every block an accessible name and pressed state", () => {
    for (const b of doc.querySelectorAll("#iso .node[role=button]")) {
      expect((b.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("offers a skip link to the details panel", () => {
    const skip = doc.querySelector("a.skip") as HTMLAnchorElement;
    expect(skip).not.toBeNull();
    expect(skip.getAttribute("href")).toBe("#dossier");
  });

  it("encodes kind with a glyph as well as a colour", () => {
    // Colour alone excludes anyone who cannot separate the hues.
    const glyphs = [...doc.querySelectorAll(".lg .gl")].map((g) => g.textContent);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((g) => (g ?? "").length > 0)).toBe(true);
  });

  it("honours reduced-motion and colour-scheme preferences in CSS", () => {
    const css = doc.querySelector("style")!.textContent ?? "";
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("prefers-color-scheme: light");
  });

  it("themes the scene through CSS variables rather than baked-in fills", () => {
    // Presentation attributes would beat the media query and strand the map in
    // dark mode for a light-theme reader.
    expect(doc.querySelector(".ground")!.getAttribute("fill")).toBeNull();
    expect(doc.querySelector(".wire")!.getAttribute("stroke")).toBeNull();
  });
});

// ── Call-graph overlay ──────────────────────────────────────────────────────

describe("iso map call overlay", () => {
  it("offers a weight toggle only when call data exists", () => {
    const without = mount(makeInput());
    expect(without.window.document.getElementById("weight")).toBeNull();
    without.window.close();

    const withCalls = mount(makeInput({
      callEdges: [{ fromZone: "api", toZone: "core", weight: 25 }],
    }));
    const btn = withCalls.window.document.getElementById("weight");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("imports");
    btn!.dispatchEvent(new withCalls.window.MouseEvent("click", { bubbles: true }));
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
    expect(btn!.textContent).toContain("calls");
    withCalls.window.close();
  });

  it("names a call-only edge as an injected seam", () => {
    const dom = mount(makeInput({
      callEdges: [{ fromZone: "db", toZone: "api", weight: 9 }],
    }));
    const doc = dom.window.document;
    const edges = [...doc.querySelectorAll("#iso .edge")];
    const injected = edges.find((e) =>
      (e.getAttribute("aria-label") ?? "").startsWith("Dependency: Db"),
    )!;
    injected.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(doc.querySelector("#dossier")!.innerHTML).toContain("only in the call graph");
    dom.window.close();
  });
});

// ── Escaping ────────────────────────────────────────────────────────────────

describe("iso map escaping", () => {
  it("neutralises markup arriving from analysis data", () => {
    const input = makeInput();
    input.zones[0].name = `<img src=x onerror="boom">`;
    input.zones[0].description = `</script><script>boom()</script>`;
    const html = renderIsoMap(buildIsoModel(input));
    // The model is embedded as JSON, so no raw closing tag may survive.
    expect(html).not.toContain("</script><script>boom");
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const doc = dom.window.document;
    const target = [...doc.querySelectorAll("#iso .node[role=button]")].find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("img src"),
    )!;
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    // Rendered as text, never as an element.
    expect(doc.querySelector("#dossier img")).toBeNull();
    expect(doc.querySelector("#dossier h3")!.textContent).toContain("<img");
    dom.window.close();
  });
});
