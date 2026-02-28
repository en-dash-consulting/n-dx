// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";
import type { ViewId } from "../../../src/viewer/types.js";
import { parsePathnameRoute } from "../../../src/viewer/route-state.js";

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function ensureBrowserStubs(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageStub(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });
}

describe("token usage sidebar navigation", () => {
  beforeEach(() => {
    ensureBrowserStubs();
  });

  function renderSidebar(view: ViewId): HTMLDivElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(
      h(Sidebar, {
        view,
        onNavigate: vi.fn(),
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
      }),
      root,
    );
    return root;
  }

  function findNavItem(root: Element, label: string): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>(".nav-item")).find((item) =>
      item.textContent?.includes(label),
    ) ?? null;
  }

  it("highlights Token Usage for direct /token-usage loads", () => {
    localStorage.setItem("sidebar-expanded-section", "SETTINGS");
    const parsed = parsePathnameRoute("/token-usage", new Set<ViewId>(["token-usage", "feature-toggles"]));
    expect(parsed).toEqual({ view: "token-usage", subId: null });

    const root = renderSidebar(parsed!.view);

    const tokenUsageItem = findNavItem(root, "Token Usage");
    const settingsItem = findNavItem(root, "Feature Flags");
    const sectionHeaders = root.querySelectorAll<HTMLElement>(".nav-section-header");
    expect(tokenUsageItem?.classList.contains("active")).toBe(true);
    expect(tokenUsageItem?.getAttribute("aria-current")).toBe("page");
    expect(settingsItem?.classList.contains("active")).toBe(false);
    expect(sectionHeaders[3].getAttribute("aria-expanded")).toBe("true");
    expect(sectionHeaders[4].getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps Token Usage highlighted after in-app navigation from Settings", () => {
    const root = renderSidebar("feature-toggles");
    render(
      h(Sidebar, {
        view: "token-usage",
        onNavigate: vi.fn(),
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
      }),
      root,
    );

    const tokenUsageItem = findNavItem(root, "Token Usage");
    const settingsItem = findNavItem(root, "Feature Flags");
    expect(tokenUsageItem?.classList.contains("active")).toBe(true);
    expect(settingsItem?.classList.contains("active")).toBe(false);
  });

  it("highlights Token Usage for legacy deep-link routes after normalization", () => {
    localStorage.setItem("sidebar-expanded-section", "SETTINGS");
    const parsed = parsePathnameRoute("/rex-dashboard/token-usage", new Set<ViewId>(["token-usage", "feature-toggles"]));
    expect(parsed).toEqual({ view: "token-usage", subId: null });

    const root = renderSidebar(parsed!.view);
    const tokenUsageItem = findNavItem(root, "Token Usage");
    const settingsItem = findNavItem(root, "Feature Flags");
    const sectionHeaders = root.querySelectorAll<HTMLElement>(".nav-section-header");
    expect(tokenUsageItem?.classList.contains("active")).toBe(true);
    expect(settingsItem?.classList.contains("active")).toBe(false);
    expect(sectionHeaders[3].getAttribute("aria-expanded")).toBe("true");
    expect(sectionHeaders[4].getAttribute("aria-expanded")).toBe("false");
  });
});
