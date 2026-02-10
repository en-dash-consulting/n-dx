// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { h, render } from "preact";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";

/** Flush Preact's microtask queue so state updates and effects are applied to the DOM.
 *  Preact schedules effects via requestAnimationFrame which jsdom polyfills as setTimeout(0).
 *  We need two ticks: one for Preact's internal scheduling, one for the effect callbacks. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0)).then(
    () => new Promise((r) => setTimeout(r, 0))
  );
}

describe("Sidebar", () => {
  let root: HTMLDivElement;
  const onNavigate = vi.fn();
  const onToggleSidebar = vi.fn();

  function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
    root = document.createElement("div");
    document.body.appendChild(root);
    render(
      h(Sidebar, {
        view: "overview" as const,
        onNavigate,
        manifest: null,
        zones: null,
        sidebarCollapsed: false,
        onToggleSidebar,
        ...props,
      }),
      root
    );
    return root;
  }

  beforeEach(() => {
    onNavigate.mockClear();
    onToggleSidebar.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    // Unmount Preact tree to clean up effects (event listeners)
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
  });

  describe("section collapse", () => {
    it("renders section headers as clickable buttons", () => {
      renderSidebar();
      const sectionHeaders = root.querySelectorAll(".nav-section-header");
      expect(sectionHeaders.length).toBe(3); // SOURCEVISION, REX, HENCH
    });

    it("section headers have aria-expanded attribute", () => {
      renderSidebar();
      const headers = root.querySelectorAll(".nav-section-header");
      headers.forEach((header) => {
        expect(header.hasAttribute("aria-expanded")).toBe(true);
      });
    });

    it("clicking a section header toggles its expanded state", async () => {
      renderSidebar();
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // SOURCEVISION is expanded by default (owns "overview" view)
      expect(headers[0].getAttribute("aria-expanded")).toBe("true");

      // Click to collapse
      headers[0].click();
      await flush();
      expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    });

    it("expanding one section collapses others (accordion behavior)", async () => {
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      expect(headers[0].getAttribute("aria-expanded")).toBe("true");
      expect(headers[1].getAttribute("aria-expanded")).toBe("false");

      // Click REX section
      headers[1].click();
      await flush();
      expect(headers[1].getAttribute("aria-expanded")).toBe("true");
      expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    });

    it("collapsed section hides its nav items", async () => {
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // Collapse SOURCEVISION
      headers[0].click();
      await flush();
      const sectionGroup = headers[0].nextElementSibling;
      expect(sectionGroup?.classList.contains("nav-section-items-collapsed")).toBe(true);
    });

    it("expanded section shows its nav items", () => {
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // SOURCEVISION should be expanded
      const sectionGroup = headers[0].nextElementSibling;
      expect(sectionGroup?.classList.contains("nav-section-items-collapsed")).toBe(false);
    });
  });

  describe("collapse state persistence", () => {
    it("saves expanded section to localStorage on toggle", async () => {
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // Click REX
      headers[1].click();
      await flush();
      const stored = localStorage.getItem("sidebar-expanded-section");
      expect(stored).toBe("REX");
    });

    it("restores expanded section from localStorage", () => {
      localStorage.setItem("sidebar-expanded-section", "REX");
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      expect(headers[1].getAttribute("aria-expanded")).toBe("true");
      expect(headers[0].getAttribute("aria-expanded")).toBe("false");
    });

    it("saves empty string when collapsing all sections", async () => {
      renderSidebar({ view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // Collapse the currently expanded SOURCEVISION section
      headers[0].click();
      await flush();
      const stored = localStorage.getItem("sidebar-expanded-section");
      expect(stored).toBe("");
    });
  });

  describe("sidebar toggle (hide/show)", () => {
    it("renders a toggle button", () => {
      renderSidebar();
      const toggleBtn = root.querySelector(".sidebar-toggle-btn");
      expect(toggleBtn).not.toBeNull();
    });

    it("toggle button has accessible label", () => {
      renderSidebar({ sidebarCollapsed: false });
      const toggleBtn = root.querySelector(".sidebar-toggle-btn");
      expect(toggleBtn?.getAttribute("aria-label")).toBe("Collapse sidebar");
    });

    it("toggle button shows expand label when sidebar is collapsed", () => {
      renderSidebar({ sidebarCollapsed: true });
      // When collapsed, the rail toggle replaces the main toggle button
      const railToggle = root.querySelector(".sidebar-rail-toggle");
      expect(railToggle?.getAttribute("aria-label")).toBe("Expand sidebar");
    });

    it("calls onToggleSidebar when toggle button is clicked", () => {
      renderSidebar({ onToggleSidebar });
      const toggleBtn = root.querySelector<HTMLElement>(".sidebar-toggle-btn");
      toggleBtn?.click();
      expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    });

    it("applies sidebar-collapsed class when collapsed", () => {
      renderSidebar({ sidebarCollapsed: true });
      const sidebar = root.querySelector(".sidebar");
      expect(sidebar?.classList.contains("sidebar-collapsed")).toBe(true);
    });

    it("does not apply sidebar-collapsed class when expanded", () => {
      renderSidebar({ sidebarCollapsed: false });
      const sidebar = root.querySelector(".sidebar");
      expect(sidebar?.classList.contains("sidebar-collapsed")).toBe(false);
    });
  });

  describe("keyboard shortcut", () => {
    it("Ctrl+B and Meta+B both toggle sidebar", async () => {
      renderSidebar();
      // Flush to let useEffect register the keyboard listener
      await flush();

      // Ctrl+B
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true })
      );
      expect(onToggleSidebar).toHaveBeenCalledTimes(1);

      // Meta+B (Cmd+B on macOS)
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true })
      );
      expect(onToggleSidebar).toHaveBeenCalledTimes(2);
    });

    it("plain B key does not toggle sidebar", async () => {
      renderSidebar();
      await flush();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", bubbles: true })
      );
      expect(onToggleSidebar).not.toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("calls onNavigate when nav item is clicked", () => {
      renderSidebar();
      const navItems = root.querySelectorAll<HTMLElement>(".nav-item");
      // Find a nav item in the expanded section and click it
      const overviewItem = Array.from(navItems).find((el) =>
        el.textContent?.includes("Overview")
      );
      overviewItem?.click();
      expect(onNavigate).toHaveBeenCalledWith("overview");
    });

    it("expands the section containing the active view on initial render", () => {
      renderSidebar({ view: "prd" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // REX section (index 1) should be expanded
      expect(headers[1].getAttribute("aria-expanded")).toBe("true");
    });

    it("hench section expands when hench view is active", () => {
      renderSidebar({ view: "hench-runs" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // HENCH section (index 2) should be expanded
      expect(headers[2].getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("section header accessibility", () => {
    it("section headers have role=button", () => {
      renderSidebar();
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      headers.forEach((header) => {
        expect(header.getAttribute("role")).toBe("button");
      });
    });

    it("section headers are focusable", () => {
      renderSidebar();
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      headers.forEach((header) => {
        expect(header.getAttribute("tabindex")).toBe("0");
      });
    });

    it("section headers have aria-controls pointing to section items", () => {
      renderSidebar();
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      headers.forEach((header) => {
        const controlsId = header.getAttribute("aria-controls");
        expect(controlsId).toBeTruthy();
        const controlled = root.querySelector(`[id="${controlsId}"]`);
        expect(controlled).not.toBeNull();
      });
    });

    it("collapsed items have tabIndex -1 to remove from tab order", () => {
      renderSidebar({ view: "overview" as const });
      // REX section is collapsed, its items should have tabIndex -1
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      const rexItemsContainer = headers[1].nextElementSibling;
      const rexNavItems = rexItemsContainer?.querySelectorAll<HTMLElement>(".nav-item");
      rexNavItems?.forEach((item) => {
        expect(item.getAttribute("tabindex")).toBe("-1");
      });
    });
  });

  describe("collapsed rail", () => {
    it("renders the rail when sidebar is collapsed", () => {
      renderSidebar({ sidebarCollapsed: true });
      const rail = root.querySelector(".sidebar-rail");
      expect(rail).not.toBeNull();
    });

    it("does not render the rail when sidebar is expanded", () => {
      renderSidebar({ sidebarCollapsed: false });
      const rail = root.querySelector(".sidebar-rail");
      expect(rail).toBeNull();
    });

    it("rail contains n-dx logo", () => {
      renderSidebar({ sidebarCollapsed: true });
      const logo = root.querySelector(".sidebar-rail-logo");
      expect(logo).not.toBeNull();
    });

    it("rail contains section icons for all three products", () => {
      renderSidebar({ sidebarCollapsed: true });
      const sections = root.querySelectorAll(".sidebar-rail-section");
      expect(sections.length).toBe(3);
      expect(root.querySelector(".sidebar-rail-section-sourcevision")).not.toBeNull();
      expect(root.querySelector(".sidebar-rail-section-rex")).not.toBeNull();
      expect(root.querySelector(".sidebar-rail-section-hench")).not.toBeNull();
    });

    it("highlights the active section with active class", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const svSection = root.querySelector(".sidebar-rail-section-sourcevision");
      expect(svSection?.classList.contains("sidebar-rail-section-active")).toBe(true);
      const rexSection = root.querySelector(".sidebar-rail-section-rex");
      expect(rexSection?.classList.contains("sidebar-rail-section-active")).toBe(false);
    });

    it("highlights rex section when rex view is active", () => {
      renderSidebar({ sidebarCollapsed: true, view: "prd" as const });
      const rexSection = root.querySelector(".sidebar-rail-section-rex");
      expect(rexSection?.classList.contains("sidebar-rail-section-active")).toBe(true);
      const svSection = root.querySelector(".sidebar-rail-section-sourcevision");
      expect(svSection?.classList.contains("sidebar-rail-section-active")).toBe(false);
    });

    it("highlights hench section when hench view is active", () => {
      renderSidebar({ sidebarCollapsed: true, view: "hench-runs" as const });
      const henchSection = root.querySelector(".sidebar-rail-section-hench");
      expect(henchSection?.classList.contains("sidebar-rail-section-active")).toBe(true);
    });

    it("active section has an indicator dot", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const activeSection = root.querySelector(".sidebar-rail-section-active");
      const indicator = activeSection?.querySelector(".sidebar-rail-indicator");
      expect(indicator).not.toBeNull();
    });

    it("inactive sections do not have indicator dots", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const inactiveSections = root.querySelectorAll(".sidebar-rail-section:not(.sidebar-rail-section-active)");
      inactiveSections.forEach((section) => {
        expect(section.querySelector(".sidebar-rail-indicator")).toBeNull();
      });
    });

    it("displays the active page label vertically", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const pageLabel = root.querySelector(".sidebar-rail-page-label");
      expect(pageLabel).not.toBeNull();
      expect(pageLabel?.textContent).toBe("Overview");
    });

    it("page label updates when navigating to different views", () => {
      renderSidebar({ sidebarCollapsed: true, view: "prd" as const });
      const pageLabel = root.querySelector(".sidebar-rail-page-label");
      expect(pageLabel?.textContent).toBe("Tasks");
    });

    it("page label has product-specific color class", () => {
      renderSidebar({ sidebarCollapsed: true, view: "prd" as const });
      const pageLabel = root.querySelector(".sidebar-rail-page-label");
      expect(pageLabel?.classList.contains("sidebar-rail-page-label-rex")).toBe(true);
    });

    it("clicking a rail section icon navigates to its first view", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const rexSection = root.querySelector<HTMLElement>(".sidebar-rail-section-rex");
      rexSection?.click();
      expect(onNavigate).toHaveBeenCalledWith("rex-dashboard");
    });

    it("clicking the n-dx logo navigates to overview", () => {
      renderSidebar({ sidebarCollapsed: true, view: "prd" as const });
      const logo = root.querySelector<HTMLElement>(".sidebar-rail-logo");
      logo?.click();
      expect(onNavigate).toHaveBeenCalledWith("overview");
    });

    it("rail toggle calls onToggleSidebar when clicked", () => {
      renderSidebar({ sidebarCollapsed: true, onToggleSidebar });
      const railToggle = root.querySelector<HTMLElement>(".sidebar-rail-toggle");
      railToggle?.click();
      expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    });

    it("active section has aria-current attribute", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const activeSection = root.querySelector(".sidebar-rail-section-active");
      expect(activeSection?.getAttribute("aria-current")).toBe("true");
    });

    it("inactive sections do not have aria-current", () => {
      renderSidebar({ sidebarCollapsed: true, view: "overview" as const });
      const inactiveSections = root.querySelectorAll(".sidebar-rail-section:not(.sidebar-rail-section-active)");
      inactiveSections.forEach((section) => {
        expect(section.hasAttribute("aria-current")).toBe(false);
      });
    });
  });

  describe("chevron indicator", () => {
    it("shows chevron on section headers", () => {
      renderSidebar();
      const chevrons = root.querySelectorAll(".nav-section-chevron");
      expect(chevrons.length).toBe(3);
    });

    it("expanded section has open chevron class", () => {
      renderSidebar({ view: "overview" as const });
      const chevrons = root.querySelectorAll(".nav-section-chevron");
      expect(chevrons[0].classList.contains("nav-section-chevron-open")).toBe(true);
      expect(chevrons[1].classList.contains("nav-section-chevron-open")).toBe(false);
    });
  });

  describe("analysis progress indicator", () => {
    const mockManifest = {
      schemaVersion: "1",
      toolVersion: "0.1.0",
      analyzedAt: "2026-01-01T00:00:00Z",
      targetPath: "/test",
      modules: {
        inventory: { status: "complete" },
        imports: { status: "complete" },
        zones: { status: "running" },
        components: { status: "pending" },
      },
    } as any;

    it("renders progress indicator inside the SourceVision section when manifest is present", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const svSection = root.querySelector("#nav-section-SOURCEVISION");
      expect(svSection).not.toBeNull();
      const progress = svSection?.querySelector(".sidebar-progress");
      expect(progress).not.toBeNull();
    });

    it("does not render progress indicator when manifest is null", () => {
      renderSidebar({ manifest: null, view: "overview" as const });
      const progress = root.querySelector(".sidebar-progress");
      expect(progress).toBeNull();
    });

    it("progress indicator is not in REX or HENCH sections", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const rexSection = root.querySelector("#nav-section-REX");
      const henchSection = root.querySelector("#nav-section-HENCH");
      expect(rexSection?.querySelector(".sidebar-progress")).toBeNull();
      expect(henchSection?.querySelector(".sidebar-progress")).toBeNull();
    });

    it("shows correct progress count", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const label = root.querySelector(".progress-label");
      expect(label?.textContent).toBe("Analysis: 2/4");
    });

    it("navigates to overview when progress indicator is clicked", () => {
      renderSidebar({ manifest: mockManifest, view: "zones" as const });
      const progress = root.querySelector<HTMLElement>(".sidebar-progress");
      progress?.click();
      expect(onNavigate).toHaveBeenCalledWith("overview");
    });

    it("progress indicator has accessible role and label", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const progress = root.querySelector(".sidebar-progress");
      expect(progress?.getAttribute("role")).toBe("button");
      expect(progress?.getAttribute("aria-label")).toContain("Analysis progress");
      expect(progress?.getAttribute("aria-label")).toContain("click to view");
    });

    it("renders module status icons", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const modules = root.querySelectorAll(".progress-module");
      expect(modules.length).toBe(4);
      // First two should be done (✓)
      expect(modules[0].classList.contains("done")).toBe(true);
      expect(modules[1].classList.contains("done")).toBe(true);
      // Last two should not be done
      expect(modules[2].classList.contains("done")).toBe(false);
      expect(modules[3].classList.contains("done")).toBe(false);
    });

    it("progress bar reflects completion percentage", () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const fill = root.querySelector<HTMLElement>(".progress-fill");
      expect(fill?.style.width).toBe("50%");
    });

    it("progress indicator collapses with the SourceVision section", async () => {
      renderSidebar({ manifest: mockManifest, view: "overview" as const });
      const headers = root.querySelectorAll<HTMLElement>(".nav-section-header");
      // Collapse SOURCEVISION section
      headers[0].click();
      await flush();
      const svSection = root.querySelector("#nav-section-SOURCEVISION");
      expect(svSection?.classList.contains("nav-section-items-collapsed")).toBe(true);
      // Progress is inside the collapsed section
      const progress = svSection?.querySelector(".sidebar-progress");
      expect(progress).not.toBeNull();
    });
  });
});
