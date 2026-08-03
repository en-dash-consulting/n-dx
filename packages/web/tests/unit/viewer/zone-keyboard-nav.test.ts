// @vitest-environment jsdom
/**
 * Zone graph keyboard navigation and ARIA attributes.
 *
 * Tests that zone nodes in the SVG diagram are keyboard-navigable
 * (tabIndex, role="button", aria-label, aria-describedby) and that
 * Enter/Space activates the node, arrow keys navigate connections.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ZonesView } from "../../../src/viewer/views/zones.js";
import type { LoadedData } from "../../../src/viewer/types.js";
import type { Zone, ZoneCrossing, Zones } from "../../../src/schema/v1.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeZone(id: string, name: string, files: string[] = [], cohesion = 0.75, coupling = 0.4): Zone {
  return { id, name, description: `${name} zone`, files, entryPoints: [], cohesion, coupling };
}

function makeCrossing(fromZone: string, toZone: string): ZoneCrossing {
  return { from: `${fromZone}/a.ts`, to: `${toZone}/b.ts`, fromZone, toZone };
}

function makeData(zones: Zone[], crossings: ZoneCrossing[]): LoadedData {
  const zoneData: Zones = { zones, crossings, unzoned: [] };
  return {
    manifest: null,
    inventory: null,
    imports: null,
    zones: zoneData,
    components: null,
    callGraph: null,
  };
}

function renderToDiv(vnode: ReturnType<typeof h>): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  render(vnode, root);
  return root;
}

/** Find all focusable zone nodes rendered as SVG <g> elements. */
function queryZoneNodes(root: HTMLElement): Element[] {
  // Use data-zone-id selector — it's a plain string attr set unconditionally.
  // tabindex on SVG <g> uses lowercase attr name (SVG attrs are case-sensitive).
  return Array.from(root.querySelectorAll("g[data-zone-id]"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("zone graph keyboard navigation", () => {
  let root: HTMLElement;

  afterEach(() => {
    if (root) {
      render(null, root);
      root.parentNode?.removeChild(root);
    }
  });

  it("every zone node has tabIndex=0 and role=button", () => {
    const zones = [makeZone("z1", "Auth"), makeZone("z2", "Core")];
    root = renderToDiv(
      h(ZonesView, { data: makeData(zones, []), onSelect: vi.fn() }),
    );
    const nodes = queryZoneNodes(root);
    expect(nodes.length).toBe(2);
    for (const node of nodes) {
      expect(node.getAttribute("role")).toBe("button");
      // tabindex is lowercase in SVG — getAttribute is case-sensitive for SVG attrs
      expect(node.getAttribute("tabindex") ?? node.getAttribute("tabIndex")).toBe("0");
    }
  });

  it("aria-label includes zone name, cohesion, coupling, file count", () => {
    const zone = makeZone("z1", "Auth", ["src/a.ts", "src/b.ts"], 0.82, 0.36);
    root = renderToDiv(
      h(ZonesView, { data: makeData([zone], []), onSelect: vi.fn() }),
    );
    const node = queryZoneNodes(root)[0];
    const label = node?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Auth");
    expect(label).toContain("zone");
    expect(label).toContain("0.82"); // cohesion
    expect(label).toContain("0.36"); // coupling
    expect(label).toContain("2 files");
  });

  it("aria-label uses correct singular 'file' for single-file zones", () => {
    const zone = makeZone("z1", "Tiny", ["src/only.ts"], 0.9, 0.1);
    root = renderToDiv(
      h(ZonesView, { data: makeData([zone], []), onSelect: vi.fn() }),
    );
    const label = queryZoneNodes(root)[0]?.getAttribute("aria-label") ?? "";
    expect(label).toContain("1 file");
    expect(label).not.toContain("1 files");
  });

  it("aria-describedby points to a <desc> element with connected zone names", () => {
    const zones = [makeZone("z1", "Auth"), makeZone("z2", "Core")];
    const crossings = [makeCrossing("z1", "z2")];
    root = renderToDiv(
      h(ZonesView, { data: makeData(zones, crossings), onSelect: vi.fn() }),
    );
    const zoneNodes = queryZoneNodes(root);
    const authNode = zoneNodes.find((n) => n.getAttribute("aria-label")?.includes("Auth"));
    expect(authNode).toBeTruthy();

    const descId = authNode!.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();

    const descEl = root.querySelector(`#${descId}`);
    expect(descEl).toBeTruthy();
    // Should mention the connected zone by name
    expect(descEl?.textContent).toContain("Core");
  });

  it("isolated zones have 'No direct connections' in their <desc>", () => {
    const zone = makeZone("z1", "Isolated");
    root = renderToDiv(
      h(ZonesView, { data: makeData([zone], []), onSelect: vi.fn() }),
    );
    const node = queryZoneNodes(root)[0];
    const descId = node?.getAttribute("aria-describedby");
    const descEl = descId ? root.querySelector(`#${descId}`) : null;
    expect(descEl?.textContent).toContain("No direct connections");
  });

  it("pressing Enter on a zone node opens the detail slideout", async () => {
    const zones = [makeZone("z1", "Auth"), makeZone("z2", "Core")];
    root = renderToDiv(
      h(ZonesView, { data: makeData(zones, []), onSelect: vi.fn() }),
    );
    const node = queryZoneNodes(root)[0] as HTMLElement;

    await act(async () => {
      node.focus();
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    // Slideout should be open — look for the slideout panel
    const slideout = root.querySelector(".zone-slideout");
    expect(slideout).toBeTruthy();
  });

  it("pressing Space on a zone node opens the detail slideout", async () => {
    const zones = [makeZone("z1", "Auth"), makeZone("z2", "Core")];
    root = renderToDiv(
      h(ZonesView, { data: makeData(zones, []), onSelect: vi.fn() }),
    );
    const node = queryZoneNodes(root)[0] as HTMLElement;

    await act(async () => {
      node.focus();
      node.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });

    const slideout = root.querySelector(".zone-slideout");
    expect(slideout).toBeTruthy();
  });

  it("pressing ArrowRight from a zone moves focus to a connected zone", async () => {
    const zones = [makeZone("z1", "Auth"), makeZone("z2", "Core")];
    const crossings = [makeCrossing("z1", "z2")];
    root = renderToDiv(
      h(ZonesView, { data: makeData(zones, crossings), onSelect: vi.fn() }),
    );
    const zoneNodes = queryZoneNodes(root);
    const authNode = zoneNodes.find((n) => n.getAttribute("aria-label")?.includes("Auth")) as HTMLElement;
    const coreNode = zoneNodes.find((n) => n.getAttribute("aria-label")?.includes("Core")) as HTMLElement;
    expect(authNode).toBeTruthy();
    expect(coreNode).toBeTruthy();

    await act(async () => {
      authNode.focus();
      authNode.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    // Focus should have moved to the Core zone (connected via crossing)
    expect(document.activeElement).toBe(coreNode);
  });
});
