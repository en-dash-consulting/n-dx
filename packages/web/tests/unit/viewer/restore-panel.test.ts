// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { RestorePanel } from "../../../src/viewer/components/prd-tree/restore-panel.js";

const REFUSAL = "Restore is v1-only until after the v2 cut; recover a v2 tree from git history.";

function stubFetch(status: number, json: () => Promise<unknown>): void {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status, json }) as unknown as typeof fetch;
}

function errorText(root: HTMLElement): string | undefined {
  return root.querySelector(".reorg-error")?.textContent ?? undefined;
}

describe("RestorePanel", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows the server's refusal when listing snapshots is refused", async () => {
    stubFetch(409, () => Promise.resolve({ ok: false, code: "V2_RESTORE_REFUSED", error: REFUSAL }));
    const root = document.createElement("div");
    render(h(RestorePanel, { open: true, onClose: () => {} }), root);
    await vi.waitFor(() => expect(errorText(root)).toBe(REFUSAL));
  });

  it("falls back to the status when the error body is unreadable", async () => {
    stubFetch(500, () => Promise.reject(new Error("not json")));
    const root = document.createElement("div");
    render(h(RestorePanel, { open: true, onClose: () => {} }), root);
    await vi.waitFor(() => expect(errorText(root)).toBe("Failed to list snapshots (500)"));
  });
});
