// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FacetFilter, type FacetFilterProps } from "../../../src/viewer/components/prd-tree/facet-filter.js";

const counts = { pending: 2, in_progress: 0, completed: 0, failing: 0, blocked: 0, deferred: 0, cancelled: 0, deleted: 0 };

function mount(over: Partial<FacetFilterProps>) {
  const root = document.createElement("div");
  const props: FacetFilterProps = {
    availableTags: [],
    activeTags: new Set(),
    activeStatuses: new Set(["pending"]),
    statusCounts: counts,
    onTagsChange: vi.fn(),
    onStatusesChange: vi.fn(),
    inboxOnly: false,
    inboxCount: 2,
    onInboxOnlyChange: vi.fn(),
    onClearAll: vi.fn(),
    ...over,
  };
  act(() => { render(h(FacetFilter, props), root); });
  return { root, props };
}

const inboxButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".prd-facet-inbox");

describe("FacetFilter — In the Inbox", () => {
  it("offers the facet with the open count and toggles it", () => {
    const { root, props } = mount({});
    const button = inboxButton(root)!;
    expect(button.textContent).toBe("In the Inbox (2)");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    act(() => { button.click(); });
    expect(props.onInboxOnlyChange).toHaveBeenCalledWith(true);
  });

  it("is hidden while the Inbox is empty and the facet is off", () => {
    expect(inboxButton(mount({ inboxCount: 0 }).root)).toBeNull();
  });

  it("shows pressed when on, and Clear facets appears and calls onClearAll", () => {
    const { root, props } = mount({ inboxOnly: true });
    expect(inboxButton(root)!.getAttribute("aria-pressed")).toBe("true");
    const clear = root.querySelector<HTMLButtonElement>(".prd-facet-clear")!;
    act(() => { clear.click(); });
    expect(props.onClearAll).toHaveBeenCalled();
  });
});
