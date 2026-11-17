// @vitest-environment jsdom
/**
 * The header-cell sort the import-graph and merge-graph table views share.
 * Pins what both tables did before they shared it: ascending on the initial
 * column, a second press on the sorted column flips it, any other column
 * starts ascending, Enter and Space press a header, and only the sorted
 * column carries an aria-sort direction and an arrow.
 */
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useColumnSort, type ColumnSort } from "../../../src/viewer/views/column-sort.js";

type Col = "a" | "b";

let root: HTMLElement | null = null;
let sort: ColumnSort<Col>;

function Probe() {
  sort = useColumnSort<Col>("a");
  return null;
}

function mount(): void {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(h(Probe, null), root!); });
}

function key(col: Col, k: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, cancelable: true });
  act(() => { sort.thKeyDown(col)(e); });
  return e;
}

afterEach(() => {
  if (root) {
    act(() => { render(null, root!); });
    root.remove();
    root = null;
  }
});

describe("useColumnSort", () => {
  it("starts ascending on the initial column", () => {
    mount();
    expect(sort.sortCol).toBe("a");
    expect(sort.sortAsc).toBe(true);
    expect(sort.ariaSort("a")).toBe("ascending");
    expect(sort.ariaSort("b")).toBe("none");
    expect(sort.sortArrow("a")).toBe(" ▲");
    expect(sort.sortArrow("b")).toBe("");
  });

  it("flips the sorted column and starts any other column ascending", () => {
    mount();
    act(() => { sort.toggleSort("a"); });
    expect(sort.sortCol).toBe("a");
    expect(sort.sortAsc).toBe(false);
    expect(sort.ariaSort("a")).toBe("descending");
    expect(sort.sortArrow("a")).toBe(" ▼");

    act(() => { sort.toggleSort("b"); });
    expect(sort.sortCol).toBe("b");
    expect(sort.sortAsc).toBe(true);
    expect(sort.ariaSort("a")).toBe("none");
    expect(sort.ariaSort("b")).toBe("ascending");

    act(() => { sort.toggleSort("b"); });
    expect(sort.sortAsc).toBe(false);
  });

  it("presses a header on Enter and Space only", () => {
    mount();
    const enter = key("b", "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(sort.sortCol).toBe("b");
    expect(sort.sortAsc).toBe(true);

    const space = key("b", " ");
    expect(space.defaultPrevented).toBe(true);
    expect(sort.sortAsc).toBe(false);

    const other = key("a", "ArrowDown");
    expect(other.defaultPrevented).toBe(false);
    expect(sort.sortCol).toBe("b");
    expect(sort.sortAsc).toBe(false);
  });
});
