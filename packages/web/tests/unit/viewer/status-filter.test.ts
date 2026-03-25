// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import {
  StatusFilter,
  ALL_STATUSES,
  FILTER_PRESETS,
  activePresetKey,
  defaultStatusFilter,
} from "../../../src/viewer/components/prd-tree/status-filter.js";
import type { ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

// ── FILTER_PRESETS ───────────────────────────────────────────────────

describe("FILTER_PRESETS", () => {
  it("has at least 4 presets", () => {
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("includes 'All Items' preset with all statuses", () => {
    const allPreset = FILTER_PRESETS.find((p) => p.key === "all");
    expect(allPreset).toBeDefined();
    expect(allPreset!.label).toBe("All Items");
    expect(allPreset!.statuses.size).toBe(ALL_STATUSES.length);
    for (const status of ALL_STATUSES) {
      expect(allPreset!.statuses.has(status)).toBe(true);
    }
  });

  it("includes 'Active Work' preset with pending, in_progress, failing, blocked", () => {
    const activePreset = FILTER_PRESETS.find((p) => p.key === "active");
    expect(activePreset).toBeDefined();
    expect(activePreset!.label).toBe("Active Work");
    expect(activePreset!.statuses).toEqual(
      new Set<ItemStatus>(["pending", "in_progress", "failing", "blocked"]),
    );
  });

  it("includes 'Completed' preset with only completed", () => {
    const completedPreset = FILTER_PRESETS.find((p) => p.key === "completed");
    expect(completedPreset).toBeDefined();
    expect(completedPreset!.label).toBe("Completed");
    expect(completedPreset!.statuses).toEqual(
      new Set<ItemStatus>(["completed"]),
    );
  });

  it("includes 'Blocked/Deferred' preset with blocked and deferred", () => {
    const blockedPreset = FILTER_PRESETS.find((p) => p.key === "blocked-deferred");
    expect(blockedPreset).toBeDefined();
    expect(blockedPreset!.label).toBe("Blocked/Deferred");
    expect(blockedPreset!.statuses).toEqual(
      new Set<ItemStatus>(["blocked", "deferred"]),
    );
  });

  it("each preset has unique key", () => {
    const keys = FILTER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("each preset has a title", () => {
    for (const preset of FILTER_PRESETS) {
      expect(preset.title.length).toBeGreaterThan(0);
    }
  });

  it("each preset has non-empty statuses", () => {
    for (const preset of FILTER_PRESETS) {
      expect(preset.statuses.size).toBeGreaterThan(0);
    }
  });
});

// ── activePresetKey ─────────────────────────────────────────────────

describe("activePresetKey", () => {
  it("returns 'all' when all statuses are active", () => {
    expect(activePresetKey(new Set(ALL_STATUSES))).toBe("all");
  });

  it("returns 'active' for pending + in_progress + failing + blocked", () => {
    expect(
      activePresetKey(new Set<ItemStatus>(["pending", "in_progress", "failing", "blocked"])),
    ).toBe("active");
  });

  it("returns 'completed' for completed-only", () => {
    expect(
      activePresetKey(new Set<ItemStatus>(["completed"])),
    ).toBe("completed");
  });

  it("returns 'blocked-deferred' for blocked + deferred", () => {
    expect(
      activePresetKey(new Set<ItemStatus>(["blocked", "deferred"])),
    ).toBe("blocked-deferred");
  });

  it("returns null for custom combination", () => {
    expect(
      activePresetKey(new Set<ItemStatus>(["pending", "completed"])),
    ).toBeNull();
  });

  it("returns 'all' for default filter (all statuses)", () => {
    expect(activePresetKey(defaultStatusFilter())).toBe("all");
  });

  it("returns null for empty set", () => {
    expect(activePresetKey(new Set<ItemStatus>())).toBeNull();
  });
});

// ── StatusFilter component ──────────────────────────────────────────

describe("StatusFilter component", () => {
  it("renders 4 preset buttons", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: defaultStatusFilter(),
        onChange: () => {},
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    expect(presets.length).toBe(4);
  });

  it("renders preset labels in order", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: defaultStatusFilter(),
        onChange: () => {},
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    expect(presets[0].textContent).toBe("All Items");
    expect(presets[1].textContent).toBe("Active Work");
    expect(presets[2].textContent).toBe("Completed");
    expect(presets[3].textContent).toBe("Blocked/Deferred");
  });

  it("marks matching preset as active", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set(ALL_STATUSES),
        onChange: () => {},
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    // "All Items" should be active
    expect(presets[0].classList.contains("active")).toBe(true);
    // Others should not
    expect(presets[1].classList.contains("active")).toBe(false);
    expect(presets[2].classList.contains("active")).toBe(false);
    expect(presets[3].classList.contains("active")).toBe(false);
  });

  it("marks 'Active Work' preset when active filter matches", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set<ItemStatus>(["pending", "in_progress", "failing", "blocked"]),
        onChange: () => {},
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    expect(presets[0].classList.contains("active")).toBe(false);
    expect(presets[1].classList.contains("active")).toBe(true);
  });

  it("shows 'Custom' indicator when no preset matches", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set<ItemStatus>(["pending", "completed"]),
        onChange: () => {},
      }),
    );
    const custom = root.querySelector(".prd-status-preset-custom");
    expect(custom).not.toBeNull();
    expect(custom!.textContent).toBe("Custom");
  });

  it("hides 'Custom' indicator when a preset matches", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set(ALL_STATUSES),
        onChange: () => {},
      }),
    );
    const custom = root.querySelector(".prd-status-preset-custom");
    expect(custom).toBeNull();
  });

  it("calls onChange with preset statuses when preset is clicked", () => {
    const onChange = vi.fn();
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: defaultStatusFilter(),
        onChange,
      }),
    );
    // Click "Completed" preset (3rd button)
    const presets = root.querySelectorAll(".prd-status-preset");
    (presets[2] as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as Set<ItemStatus>;
    expect(arg).toEqual(new Set<ItemStatus>(["completed"]));
  });

  it("calls onChange with all statuses when 'All Items' preset is clicked", () => {
    const onChange = vi.fn();
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set<ItemStatus>(["pending"]),
        onChange,
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    (presets[0] as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as Set<ItemStatus>;
    expect(arg.size).toBe(ALL_STATUSES.length);
  });

  it("renders 7 status chips", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: defaultStatusFilter(),
        onChange: () => {},
      }),
    );
    const chips = root.querySelectorAll(".prd-status-chip");
    expect(chips.length).toBe(7);
  });

  it("sets aria-pressed on preset buttons", () => {
    const root = renderToDiv(
      h(StatusFilter, {
        activeStatuses: new Set<ItemStatus>(["completed"]),
        onChange: () => {},
      }),
    );
    const presets = root.querySelectorAll(".prd-status-preset");
    // "Completed" preset should have aria-pressed="true"
    expect(presets[2].getAttribute("aria-pressed")).toBe("true");
    // Others should be false
    expect(presets[0].getAttribute("aria-pressed")).toBe("false");
    expect(presets[1].getAttribute("aria-pressed")).toBe("false");
    expect(presets[3].getAttribute("aria-pressed")).toBe("false");
  });
});
