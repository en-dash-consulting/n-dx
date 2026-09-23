// @vitest-environment jsdom
/**
 * Render-level checks for the glossary lines whose placement depends on a
 * condition or on accessibility markup.
 *
 * `glossary-terms.test.ts` scans source for `h(GlossaryLine, { term })` calls,
 * which catches a term nobody wired. It cannot catch a call that never renders
 * because the branch around it stopped matching — renaming hench's "guard"
 * config category would strand the guard-rail definition while the scan still
 * passed. These tests render the host components and assert on the DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FilesView } from "../../../src/viewer/views/files.js";
import { HenchConfigView } from "../../../src/viewer/views/hench-config.js";
import { ZoneSlideout } from "../../../src/viewer/components/zone-slideout.js";
import { getGlossaryDefinition } from "../../../src/viewer/components/glossary-terms.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { Inventory, Zone } from "../../../src/viewer/external.js";

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

/** Elements whose text is exactly the given term's definition. */
function definitionNodes(term: string): Element[] {
  const text = getGlossaryDefinition(term)!;
  return [...root.querySelectorAll("p")].filter((p) => p.textContent === text);
}

describe("[a11y] Files: archetype definition", () => {
  function makeData(): LoadedData {
    return {
      manifest: null,
      inventory: {
        files: [
          { path: "src/app.ts", size: 100, language: "TypeScript", lineCount: 10, hash: "abc", role: "source", category: "src" },
        ],
        summary: {
          totalFiles: 1, totalLines: 10,
          byLanguage: { TypeScript: 1 }, byRole: { source: 1 }, byCategory: { src: 1 },
        },
      } as Inventory,
      imports: null, zones: null, components: null, callGraph: null,
    };
  }

  async function renderFiles(classifications: unknown | null) {
    vi.stubGlobal("fetch", vi.fn(async () =>
      classifications
        ? { ok: true, status: 200, json: async () => classifications }
        : { ok: false, status: 404, json: async () => ({}) },
    ));
    act(() => { render(h(FilesView, { data: makeData(), onSelect: () => {} }), root); });
    await act(async () => {});
    await act(async () => {});
  }

  it("is read once as the table's description, not from inside the header cell", async () => {
    await renderFiles({ archetypes: [{ id: "component" }], files: [{ path: "src/app.ts", archetype: "component" }] });

    const table = root.querySelector("table.data-table")!;
    const describedBy = table.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const description = root.querySelector(`#${describedBy}`)!;
    expect(description.textContent).toBe(getGlossaryDefinition("archetype"));
    expect(description.classList.contains("sr-only")).toBe(true);

    // The visual copy in the header is hidden from assistive technology, so a
    // screen reader does not repeat it before every cell in the column.
    const inHeader = table.querySelector("th p")!;
    expect(inHeader.textContent).toBe(getGlossaryDefinition("archetype"));
    expect(inHeader.getAttribute("aria-hidden")).toBe("true");

    const announced = definitionNodes("archetype").filter((n) => n.getAttribute("aria-hidden") !== "true");
    expect(announced).toHaveLength(1);
  });

  it("renders no archetype definition or description when there is no Archetype column", async () => {
    await renderFiles(null);

    expect(root.querySelector("table.data-table")!.hasAttribute("aria-describedby")).toBe(false);
    expect(definitionNodes("archetype")).toHaveLength(0);
  });
});

describe("hench Config: guard rail definition", () => {
  function field(path: string, category: string) {
    return {
      path, label: path, description: "", type: "number", category,
      value: 1, defaultValue: 1, isDefault: true, impact: "",
    };
  }

  async function renderConfig() {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        config: { schema: "hench/v1", maxTurns: 1, guard: { commandTimeout: 1 } },
        fields: [field("maxTurns", "execution"), field("guard.commandTimeout", "guard")],
      }),
    })));
    await act(async () => { render(h(HenchConfigView, null), root); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {});
  }

  it("renders under the Guard Rails category and nowhere else", async () => {
    await renderConfig();

    const nodes = definitionNodes("guard rail");
    expect(nodes).toHaveLength(1);
    const category = nodes[0]!.closest(".hench-config-category")!;
    expect(category.querySelector(".hench-config-category-title")!.textContent).toMatch(/guard/i);
  });
});

describe("Zone slideout: zone pin definition", () => {
  function makeZone(): Zone {
    return {
      id: "zone-1", name: "Zone One", description: "A test zone",
      files: ["src/a.ts", "src/b.ts"], entryPoints: [], cohesion: 0.7, coupling: 0.2,
    } as Zone;
  }

  function renderSlideout(pinnedFiles?: Set<string>) {
    const zone = makeZone();
    act(() => {
      render(h(ZoneSlideout, { zone, crossings: [], allZones: [zone], pinnedFiles, onClose: () => {} }), root);
    });
  }

  it("renders when one of the zone's files is pinned", () => {
    renderSlideout(new Set(["src/b.ts"]));
    expect(definitionNodes("zone pin")).toHaveLength(1);
  });

  it("does not render when no file in the zone is pinned", () => {
    renderSlideout(new Set(["src/elsewhere.ts"]));
    expect(definitionNodes("zone pin")).toHaveLength(0);
  });

  it("does not render when the project has no zone pins", () => {
    renderSlideout(undefined);
    expect(definitionNodes("zone pin")).toHaveLength(0);
  });
});
