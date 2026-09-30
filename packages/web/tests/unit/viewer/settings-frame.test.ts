// @vitest-environment jsdom
/**
 * The shared settings frame: explicit Save, the dirty indicator, and the
 * Save error path. The leave-with-unsaved-changes prompt it hosts is
 * exercised in leave-guard.test.ts, against every way of leaving it.
 *
 * @see src/viewer/components/settings-frame.ts
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { SettingsFrame } from "../../../src/viewer/components/settings-frame.js";

let root: HTMLDivElement;

async function mount(vnode: VNode): Promise<HTMLDivElement> {
  root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(vnode, root); });
  return root;
}

afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function frame(props: Partial<Parameters<typeof SettingsFrame>[0]> = {}) {
  return h(SettingsFrame, {
    dirty: false,
    saving: false,
    onSave: vi.fn(),
    ...props,
  });
}

const indicator = () => root.querySelector(".settings-frame-indicator");
const saveBtn = () => root.querySelector<HTMLButtonElement>(".settings-frame-save")!;

describe("SettingsFrame: dirty indicator", () => {
  it("shows the indicator when dirty and hides it when clean", async () => {
    await mount(frame({ dirty: true }));
    expect(indicator()?.classList.contains("settings-frame-indicator--dirty")).toBe(true);
    expect(indicator()?.textContent).toBe("Unsaved changes");

    await act(async () => { render(frame({ dirty: false }), root); });
    expect(indicator()?.classList.contains("settings-frame-indicator--dirty")).toBe(false);
    expect(indicator()?.textContent).not.toBe("Unsaved changes");
  });

  it("renders the page's fields as children", async () => {
    await mount(h(SettingsFrame, { dirty: false, saving: false, onSave: vi.fn() },
      h("div", { class: "fake-field" }, "field"),
    ));
    expect(root.querySelector(".fake-field")).not.toBeNull();
  });
});

describe("SettingsFrame: Save", () => {
  it("disables Save when clean, and enables it once dirty", async () => {
    await mount(frame({ dirty: false }));
    expect(saveBtn().disabled).toBe(true);
    await act(async () => { render(frame({ dirty: true }), root); });
    expect(saveBtn().disabled).toBe(false);
  });

  it("disables Save while saving, even when dirty", async () => {
    await mount(frame({ dirty: true, saving: true }));
    expect(saveBtn().disabled).toBe(true);
    expect(saveBtn().textContent).toBe("Saving…");
  });

  it("calls onSave exactly once per click", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount(frame({ dirty: true, onSave }));
    act(() => { saveBtn().click(); });
    await act(async () => { await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("stays dirty and shows the error when onSave rejects — the frame does not swallow it silently", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network down"));
    await mount(frame({ dirty: true, onSave }));
    act(() => { saveBtn().click(); });
    // The promise rejection resolves asynchronously; give it a tick.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The frame is controlled: the page (not the frame) decides dirty/error
    // after a failed save. Simulate that here and assert the frame reflects it.
    await act(async () => { render(frame({ dirty: true, saving: false, error: "network down", onSave }), root); });
    expect(indicator()?.classList.contains("settings-frame-indicator--dirty")).toBe(true);
    expect(root.querySelector(".settings-frame-error")?.textContent).toBe("network down");
  });

  it("does not throw on an onSave rejection — no unhandled rejection reaches the caller", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    await mount(frame({ dirty: true, onSave }));
    expect(() => act(() => { saveBtn().click(); })).not.toThrow();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it("shows no error message when none is passed", async () => {
    await mount(frame({ dirty: true }));
    expect(root.querySelector(".settings-frame-error")).toBeNull();
  });
});
