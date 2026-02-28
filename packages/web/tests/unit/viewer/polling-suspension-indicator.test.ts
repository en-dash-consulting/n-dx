// @vitest-environment jsdom
/**
 * Tests for the PollingSuspensionIndicator component.
 *
 * Covers: visibility when suspended/not suspended, text content,
 * manual refresh button, accessibility attributes, and plural handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { PollingSuspensionIndicator } from "../../../src/viewer/components/polling-suspension-indicator.js";

function makeProps(
  overrides: Partial<Parameters<typeof PollingSuspensionIndicator>[0]> = {},
) {
  return {
    isSuspended: true,
    suspendedCount: 3,
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe("PollingSuspensionIndicator", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
  });

  it("renders nothing when not suspended", () => {
    render(h(PollingSuspensionIndicator, makeProps({ isSuspended: false })), root);
    expect(root.children.length).toBe(0);
  });

  it("renders the indicator when suspended", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const indicator = root.querySelector(".polling-suspension-indicator");
    expect(indicator).not.toBeNull();
  });

  it("displays 'Auto-refresh paused' title", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const title = root.querySelector(".polling-suspension-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Auto-refresh paused");
  });

  it("shows plural data sources count", () => {
    render(h(PollingSuspensionIndicator, makeProps({ suspendedCount: 3 })), root);
    const detail = root.querySelector(".polling-suspension-detail");
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain("3 data sources paused");
    expect(detail!.textContent).toContain("memory pressure");
  });

  it("shows singular data source count", () => {
    render(h(PollingSuspensionIndicator, makeProps({ suspendedCount: 1 })), root);
    const detail = root.querySelector(".polling-suspension-detail");
    expect(detail!.textContent).toContain("1 data source paused");
  });

  it("renders a manual refresh button", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const btn = root.querySelector<HTMLButtonElement>(".polling-suspension-refresh");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("Refresh");
    expect(btn!.type).toBe("button");
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(h(PollingSuspensionIndicator, makeProps({ onRefresh })), root);
    const btn = root.querySelector<HTMLButtonElement>(".polling-suspension-refresh");
    btn!.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("has role=status for accessibility", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const indicator = root.querySelector(".polling-suspension-indicator");
    expect(indicator!.getAttribute("role")).toBe("status");
    expect(indicator!.getAttribute("aria-live")).toBe("polite");
  });

  it("has an accessible label on the container", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const indicator = root.querySelector(".polling-suspension-indicator");
    expect(indicator!.getAttribute("aria-label")).toBe(
      "Auto-refresh suspended due to memory pressure",
    );
  });

  it("refresh button has an accessible label", () => {
    render(h(PollingSuspensionIndicator, makeProps()), root);
    const btn = root.querySelector<HTMLButtonElement>(".polling-suspension-refresh");
    expect(btn!.getAttribute("aria-label")).toBe("Refresh data now");
  });

  it("shows zero suspended count correctly", () => {
    render(
      h(PollingSuspensionIndicator, makeProps({ isSuspended: true, suspendedCount: 0 })),
      root,
    );
    const detail = root.querySelector(".polling-suspension-detail");
    expect(detail!.textContent).toContain("0 data sources paused");
  });
});
