// @vitest-environment jsdom
/**
 * The leave-with-unsaved-changes guard: every way of leaving a dirty
 * settings frame prompts first, and nothing changes — view, URL or field
 * values — until the user picks "Discard changes".
 *
 * The overlay's ✕ and Escape, and switching overlay entries, all route
 * through `handleSidebarNav` (see settings-overlay.ts / main.ts), so
 * covering `handleSidebarNav` itself covers those paths too; this file
 * exercises it directly rather than through the overlay chrome.
 *
 * @see src/viewer/hooks/use-leave-guard.ts
 * @see src/viewer/hooks/use-route-state.ts — navigateTo / handleSidebarNav / popstate
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render, Fragment } from "preact";
import type { VNode } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { useRouteState } from "../../../src/viewer/hooks/use-route-state.js";
import { useLeaveGuard, guardedLeave, isLeaveGuarded } from "../../../src/viewer/hooks/use-leave-guard.js";
import { SettingsFrame } from "../../../src/viewer/components/settings-frame.js";
import { buildValidViews } from "../../../src/shared/index.js";
import type { ViewId } from "../../../src/viewer/types.js";

const ALL = buildValidViews(null);

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
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

// ── Plain module API ────────────────────────────────────────────

describe("guardedLeave / isLeaveGuarded: no guard registered", () => {
  it("runs the action immediately and reports it ran", () => {
    const action = vi.fn();
    expect(isLeaveGuarded()).toBe(false);
    expect(guardedLeave(action)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });
});

// ── The route-state integration harness ────────────────────────
//
// useRouteState lives at the app root; a settings frame mounts deep inside
// the overlay's content. This harness wires them the way main.ts does, so
// the guard's cross-tree contract is exercised for real rather than mocked.

function Harness({ dirty, setDirty }: { dirty: boolean; setDirty: (d: boolean) => void }) {
  const { view, navigateTo, handleSidebarNav } = useRouteState(ALL);
  const [discards, setDiscards] = useState(0);
  return h(Fragment, null,
    h("div", { class: "current-view" }, view),
    h("div", { class: "discard-count" }, String(discards)),
    h("button", { class: "nav-home", onClick: () => navigateTo("home") }, "navigateTo home"),
    h("button", { class: "sidebar-home", onClick: () => handleSidebarNav("home") }, "handleSidebarNav home"),
    h("button", { class: "sidebar-same", onClick: () => handleSidebarNav("robot-wrangler") }, "handleSidebarNav self"),
    view === "robot-wrangler"
      ? h(SettingsFrame, {
          dirty,
          saving: false,
          onSave: () => Promise.resolve(),
          onDiscard: () => setDiscards((c) => c + 1),
        }, h("div", { class: "fake-field" }, "field"))
      : null,
  );
}

function HarnessHost({ initialDirty }: { initialDirty: boolean }) {
  const [dirty, setDirty] = useState(initialDirty);
  return h(Fragment, null,
    h("button", { class: "toggle-dirty", onClick: () => setDirty((d) => !d) }, "toggle dirty"),
    h(Harness, { dirty, setDirty }),
  );
}

async function mountAtSettings(initialDirty: boolean): Promise<HTMLDivElement> {
  window.history.pushState(null, "", "/robot-wrangler");
  const el = await mount(h(HarnessHost, { initialDirty }));
  expect(el.querySelector(".current-view")?.textContent).toBe("robot-wrangler");
  return el;
}

const currentView = () => root.querySelector(".current-view")?.textContent;
const discardCount = () => root.querySelector(".discard-count")?.textContent;
const dialog = () => root.querySelector(".leave-guard-backdrop");
const keepBtn = () => root.querySelector<HTMLButtonElement>(".leave-guard-keep-btn");
const discardBtn = () => root.querySelector<HTMLButtonElement>(".leave-guard-discard-btn");

describe("clean frame: navigation behaves exactly as before", () => {
  it("navigateTo and handleSidebarNav apply immediately, no prompt", async () => {
    await mountAtSettings(false);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    expect(currentView()).toBe("home");
    expect(dialog()).toBeNull();
  });
});

describe("dirty frame: navigateTo prompts", () => {
  it("blocks navigation, then Keep editing leaves everything unchanged", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    expect(dialog()).not.toBeNull();
    expect(currentView()).toBe("robot-wrangler");
    expect(location.pathname).toBe("/robot-wrangler");

    act(() => { keepBtn()!.click(); });
    expect(dialog()).toBeNull();
    expect(currentView()).toBe("robot-wrangler");
    expect(location.pathname).toBe("/robot-wrangler");
    expect(discardCount()).toBe("0");
  });

  it("Discard changes restores saved values and completes the navigation", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    expect(dialog()).not.toBeNull();

    act(() => { discardBtn()!.click(); });
    expect(dialog()).toBeNull();
    expect(currentView()).toBe("home");
    expect(discardCount()).toBe("1");
  });
});

describe("dirty frame: handleSidebarNav prompts (covers switching overlay entries and ✕/Escape)", () => {
  it("blocks, Keep editing stays, Discard completes", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".sidebar-home")!.click(); });
    expect(dialog()).not.toBeNull();

    act(() => { keepBtn()!.click(); });
    expect(currentView()).toBe("robot-wrangler");

    act(() => { root.querySelector<HTMLButtonElement>(".sidebar-home")!.click(); });
    act(() => { discardBtn()!.click(); });
    expect(currentView()).toBe("home");
  });
});

describe("dirty frame: a discard that does not leave the page keeps guarding", () => {
  it("still prompts on the next navigation after discarding onto the same view", async () => {
    // Clicking the settings entry you are already on is a live button in
    // SettingsOverlay, and every setter in applyEntry then bails out on an
    // unchanged value — so the frame never unmounts and the page is still
    // dirty. The guard has to survive that, or the next ✕ silently drops
    // the edits it exists to protect.
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".sidebar-same")!.click(); });
    expect(dialog()).not.toBeNull();

    act(() => { discardBtn()!.click(); });
    expect(currentView()).toBe("robot-wrangler");
    expect(root.querySelector(".settings-frame")).not.toBeNull();
    expect(isLeaveGuarded()).toBe(true);

    // The real consequence: leaving for good must still prompt.
    act(() => { root.querySelector<HTMLButtonElement>(".sidebar-home")!.click(); });
    expect(dialog()).not.toBeNull();
    expect(currentView()).toBe("robot-wrangler");
  });
});

describe("dirty frame: browser back/forward", () => {
  function popStateTo(target: { view: ViewId; url: string }) {
    const state = { view: target.view, file: null, zone: null, runId: null, taskId: null, askSeed: null };
    // The browser moves `location` before delivering the event — simulate
    // that first, then dispatch, same as a real back/forward.
    window.history.replaceState(state, "", target.url);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  }

  it("re-pushes the settings URL when blocked, and Keep editing leaves it there", async () => {
    await mountAtSettings(true);

    act(() => { popStateTo({ view: "home", url: "/home" }); });
    expect(dialog()).not.toBeNull();
    // popstate can't be cancelled — the guard re-pushes over the browser's
    // own navigation so the address bar (and view) land back on settings.
    expect(location.pathname).toBe("/robot-wrangler");
    expect(currentView()).toBe("robot-wrangler");

    act(() => { keepBtn()!.click(); });
    expect(dialog()).toBeNull();
    expect(location.pathname).toBe("/robot-wrangler");
    expect(currentView()).toBe("robot-wrangler");
  });

  it("Discard changes completes the popped-to navigation", async () => {
    await mountAtSettings(true);
    act(() => { popStateTo({ view: "home", url: "/home" }); });
    expect(dialog()).not.toBeNull();

    act(() => { discardBtn()!.click(); });
    expect(dialog()).toBeNull();
    expect(currentView()).toBe("home");
    expect(location.pathname).toBe("/home");
    expect(discardCount()).toBe("1");
  });
});

describe("dirty frame: Escape and backdrop click keep editing, not discard", () => {
  it("Escape closes the prompt without navigating", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    expect(dialog()).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(dialog()).toBeNull();
    expect(currentView()).toBe("robot-wrangler");
  });

  it("one Escape closes the prompt even with the overlay's own Escape handler on window", async () => {
    await mountAtSettings(true);
    // settings-overlay.ts closes on Escape from a window keydown listener; mirror it.
    const overlayEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") root.querySelector<HTMLButtonElement>(".sidebar-home")!.click();
    };
    window.addEventListener("keydown", overlayEscape);
    try {
      act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
      expect(dialog()).not.toBeNull();
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      expect(dialog()).toBeNull();
      expect(currentView()).toBe("robot-wrangler");
    } finally {
      window.removeEventListener("keydown", overlayEscape);
    }
  });

  it("a backdrop click closes the prompt without navigating", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    act(() => { dialog()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(currentView()).toBe("robot-wrangler");
  });
});

describe("the prompt honours its aria-modal contract", () => {
  it("traps Tab inside the prompt, so the nav behind it stays unreachable", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".nav-home")!.click(); });
    const modal = root.querySelector<HTMLElement>(".leave-guard-modal")!;
    const focusables = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"));
    expect(focusables.length).toBe(2);
    const [first, last] = [focusables[0], focusables[focusables.length - 1]];

    // Tab from the last focusable wraps to the first rather than escaping
    // to the buttons behind the backdrop.
    last.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first wraps to the last.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(last);
  });
});

describe("beforeunload: only while dirty", () => {
  function dispatchBeforeUnload(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("prevents the default while dirty", async () => {
    await mountAtSettings(true);
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("does nothing once clean", async () => {
    await mountAtSettings(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("stops guarding once the frame unmounts", async () => {
    await mountAtSettings(true);
    act(() => { root.querySelector<HTMLButtonElement>(".sidebar-home")!.click(); });
    act(() => { discardBtn()!.click(); });
    expect(currentView()).toBe("home");
    expect(dispatchBeforeUnload()).toBe(false);
  });
});

// ── The hook's own reactivity, isolated from route-state ───────

describe("useLeaveGuard in isolation", () => {
  function Consumer({ dirty }: { dirty: boolean }) {
    const { promptOpen, keepEditing, discardChanges } = useLeaveGuard(dirty);
    return h(Fragment, null,
      h("div", { class: "prompt-open" }, String(promptOpen)),
      h("button", { class: "keep", onClick: keepEditing }, "keep"),
      h("button", { class: "discard", onClick: discardChanges }, "discard"),
    );
  }

  it("registers as guarded while dirty, and clears on unmount", async () => {
    await mount(h(Consumer, { dirty: true }));
    expect(isLeaveGuarded()).toBe(true);
    render(null, root);
    expect(isLeaveGuarded()).toBe(false);
  });

  it("opens the prompt when a navigation is attempted while guarded", async () => {
    await mount(h(Consumer, { dirty: true }));
    const action = vi.fn();
    act(() => { expect(guardedLeave(action)).toBe(false); });
    expect(action).not.toHaveBeenCalled();
    expect(root.querySelector(".prompt-open")?.textContent).toBe("true");

    act(() => { root.querySelector<HTMLButtonElement>(".discard")!.click(); });
    expect(action).toHaveBeenCalledOnce();
    expect(root.querySelector(".prompt-open")?.textContent).toBe("false");
  });
});
