// @vitest-environment jsdom
/**
 * The open Inbox count: the bottom-bar pill and the helper the Plan tab uses.
 * Hidden at zero and on v1 (no `inbox` in status).
 *
 * @see src/viewer/components/status-indicators.ts
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import {
  InboxIndicator,
  openInboxCount,
  inboxCountLabel,
} from "../../../src/viewer/components/status-indicators.js";

describe("openInboxCount", () => {
  it("reads rex.inbox.open", () => {
    expect(openInboxCount({ inbox: { open: 4, appliedUnplaced: 156 } })).toBe(4);
  });
  it("is 0 on v1, with no status, and at zero", () => {
    expect(openInboxCount({})).toBe(0);
    expect(openInboxCount(undefined)).toBe(0);
    expect(openInboxCount({ inbox: { open: 0, appliedUnplaced: 156 } })).toBe(0);
  });
  it("names the count for a screen reader", () => {
    expect(inboxCountLabel(1)).toBe("1 change in the Inbox");
    expect(inboxCountLabel(3)).toBe("3 changes in the Inbox");
  });
});

describe("InboxIndicator", () => {
  const root = document.createElement("div");
  afterEach(() => render(null, root));

  it("renders 'Inbox N' and opens the Inbox view", () => {
    const onNavigate = vi.fn();
    render(h(InboxIndicator, { count: 3, onNavigate, tabIndex: 0 }), root);
    expect(root.textContent).toBe("Inbox3");
    (root.querySelector("button") as HTMLButtonElement).click();
    expect(onNavigate).toHaveBeenCalledWith("inbox");
  });

  it("renders nothing at zero", () => {
    render(h(InboxIndicator, { count: 0, onNavigate: vi.fn(), tabIndex: 0 }), root);
    expect(root.innerHTML).toBe("");
  });
});
