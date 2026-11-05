// @vitest-environment jsdom
/**
 * The area view's spec map: a block per capability sized by criteria and
 * tinted by status, open-change markers, constraint bands, ordering and
 * keyboard selection.
 *
 * @see src/viewer/views/area-spec-map.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  SpecMap, appliesToLabel, capabilityBlock, orderCapabilities,
  specBlockBasis, SPEC_BLOCK_FLOOR_REM, SPEC_BLOCK_REM_PER_CRITERION,
} from "../../../src/viewer/views/area-spec-map.js";
import { blockName } from "../../../src/viewer/views/product-area-map.js";
import { AREA_DETAIL_FIXTURE } from "../../fixtures/v2-product-map.js";
import type { CapabilityRow } from "../../../src/viewer/views/product-model.js";

const CAPS = AREA_DETAIL_FIXTURE.capabilities;
const row = (over: Partial<CapabilityRow>): CapabilityRow => ({
  id: "c", title: "C", status: "met", health: "ok", criteriaCount: 1, openChanges: [], ...over,
});

let root: HTMLDivElement | null = null;
function mount(props: Partial<Parameters<typeof SpecMap>[0]> = {}): HTMLDivElement {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => {
    render(h(SpecMap, { capabilities: CAPS, constraints: AREA_DETAIL_FIXTURE.constraints, onSelect: vi.fn(), ...props }), root!);
  });
  return root;
}
afterEach(() => {
  if (root) act(() => { render(null, root!); });
  root?.remove();
  root = null;
});

describe("ordering", () => {
  it("puts changing and defective first, then larger specs, then listed order", () => {
    const rows = [
      row({ id: "small", criteriaCount: 1 }),
      row({ id: "big", criteriaCount: 5 }),
      row({ id: "broken", health: "defective", criteriaCount: 2 }),
      row({ id: "moving", status: "changing", criteriaCount: 3 }),
      row({ id: "tie", criteriaCount: 1 }),
    ];
    expect(orderCapabilities(rows).map((r) => r.id)).toEqual(["moving", "broken", "big", "small", "tie"]);
  });
});

describe("capabilityBlock", () => {
  it("sizes by criteria, tints by status and counts each open change once", () => {
    const change = { id: "x", title: "X", stage: "in-progress" as const };
    const block = capabilityBlock(row({ criteriaCount: 4, health: "defective", openChanges: [change, change] }));
    expect(block).toMatchObject({ size: 4, unit: "criteria", status: "defective", openChanges: 1 });
    expect(blockName(block)).toBe("C: 4 criteria, defective, 1 open change");
    expect(blockName(capabilityBlock(row({ criteriaCount: 1 })))).toBe("C: 1 criterion, met, no open changes");
  });
});

describe("specBlockBasis", () => {
  it("grows with criteria above a readable floor, so 10x the criteria is at least 3x the width", () => {
    expect(specBlockBasis(0)).toBe(SPEC_BLOCK_FLOOR_REM);
    expect(specBlockBasis(1)).toBe(SPEC_BLOCK_FLOOR_REM);
    expect(specBlockBasis(20)).toBe(20 * SPEC_BLOCK_REM_PER_CRITERION);
    for (const n of [1, 2, 4, 5]) expect(specBlockBasis(10 * n) / specBlockBasis(n)).toBeGreaterThanOrEqual(3);
  });
});

describe("SpecMap", () => {
  it("draws one block per capability, changing first, with status and open-change markers", () => {
    const el = mount();
    const blocks = [...el.querySelectorAll<HTMLButtonElement>(".pam-block")];
    expect(blocks.map((b) => b.dataset.block)).toEqual(["cap-placement", "cap-natural-language-authoring", "cap-spec-review"]);
    expect(blocks.map((b) => b.dataset.status)).toEqual(["changing", "met", "proposed"]);
    expect(blocks.map((b) => b.style.flexGrow)).toEqual(["2", "3", "1"]);
    // The basis comes from the criteria count too, so a wrapped row cannot
    // flatten every block to the same width; one criterion keeps the floor.
    expect(blocks.map((b) => b.style.flexBasis)).toEqual([
      `${SPEC_BLOCK_FLOOR_REM}rem`,
      `${3 * SPEC_BLOCK_REM_PER_CRITERION}rem`,
      `${SPEC_BLOCK_FLOOR_REM}rem`,
    ]);
    expect(blocks[0]!.querySelector(".pam-open")?.textContent).toBe("1");
    expect(blocks[1]!.querySelector(".pam-open")).toBeNull();
    expect(blocks[0]!.getAttribute("aria-label")).toBe("Automatic placement: 2 criteria, changing, 1 open change");
  });

  it("leaves a retired capability off the map rather than drawing it as proposed", () => {
    const el = mount({ capabilities: [...CAPS, row({ id: "gone", title: "Gone", status: "retired" })] });
    const blocks = [...el.querySelectorAll<HTMLButtonElement>(".pam-block")];
    expect(blocks.map((b) => b.dataset.block)).not.toContain("gone");
    expect(blocks).toHaveLength(CAPS.length);
    expect(el.querySelector('[data-status="proposed"][data-block="gone"]')).toBeNull();
  });

  it("draws binding constraints as bands above the map", () => {
    const el = mount();
    const bands = el.querySelector(".asm-bands")!;
    expect(bands.compareDocumentPosition(el.querySelector(".pam")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bands.querySelector("li")?.textContent).toContain(AREA_DETAIL_FIXTURE.constraints[0]!.title);
    expect(bands.querySelector(".tag")?.textContent).toBe("all product nodes");
  });

  it("draws no bands when nothing binds, and says so when the area is empty", () => {
    const el = mount({ constraints: [], capabilities: [] });
    expect(el.querySelector(".asm-bands")).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toBe("This area has no capabilities yet.");
  });

  it("says the capabilities are retired when every one is, not that none exist", () => {
    const el = mount({ capabilities: [row({ id: "a", status: "retired" }), row({ id: "b", status: "retired" })] });
    const text = el.querySelector('[role="status"]')?.textContent;
    expect(text).toBe("All of this area's capabilities are retired.");
    expect(text).not.toContain("no capabilities yet");
    expect(el.querySelector(".pam-block")).toBeNull();
  });

  it("selects a block with a click on its native button and marks it pressed", () => {
    const onSelect = vi.fn();
    const el = mount({ onSelect, selectedId: "cap-placement" });
    const [first, second] = [...el.querySelectorAll<HTMLButtonElement>(".pam-block")];
    expect(first!.tagName).toBe("BUTTON");
    expect(first!.getAttribute("aria-pressed")).toBe("true");
    expect(second!.getAttribute("aria-pressed")).toBe("false");
    act(() => second!.click());
    expect(onSelect).toHaveBeenCalledWith("cap-natural-language-authoring");
  });
});

describe("appliesToLabel", () => {
  it("names all nodes or lists the ones bound", () => {
    expect(appliesToLabel("all")).toBe("all product nodes");
    expect(appliesToLabel(["A", "B"])).toBe("A, B");
  });
});

describe("selected and focused blocks look different", () => {
  const css = readFileSync(join(process.cwd(), "src/viewer/styles/product.css"), "utf8");
  const declarations = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
  };

  it("keeps the outline for focus and draws selection another way", () => {
    expect(declarations(".pam-block:focus-visible")).toContain("outline");
    const selected = declarations('.pam-block[aria-pressed="true"]');
    expect(selected).toContain("box-shadow");
    expect(selected).not.toContain("outline");
    // The status tint (.pam-met, .pam-defective …) must survive selection.
    expect(selected).not.toContain("background");
  });

  it("keeps selection visible when forced colours drop box-shadow", () => {
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toMatch(/\.pam-block\[aria-pressed="true"\]\s*\{[^}]*border:[^}]*Highlight/);
  });
});
