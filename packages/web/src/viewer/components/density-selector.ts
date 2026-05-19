import { h } from "preact";
import { useState } from "preact/hooks";

type Density = "small" | "medium" | "large";

const DENSITY_KEY = "ndx.ui.density";
const DEFAULT_DENSITY: Density = "medium";

const DENSITY_OPTIONS: Array<{ value: Density; label: string; aria: string }> = [
  { value: "small",  label: "S", aria: "Compact density" },
  { value: "medium", label: "M", aria: "Default density" },
  { value: "large",  label: "L", aria: "Spacious density" },
];

function isValidDensity(v: string | null): v is Density {
  return v === "small" || v === "medium" || v === "large";
}

/** Apply stored density to root element (call before first paint). */
export function initDensity() {
  const stored = localStorage.getItem(DENSITY_KEY);
  const density: Density = isValidDensity(stored) ? stored : DEFAULT_DENSITY;
  document.documentElement.setAttribute("data-density", density);
}

function useDensity() {
  const [density, setDensityState] = useState<Density>(() => {
    const attr = document.documentElement.getAttribute("data-density");
    return isValidDensity(attr) ? attr : DEFAULT_DENSITY;
  });

  const setDensity = (next: Density) => {
    document.documentElement.setAttribute("data-density", next);
    try { localStorage.setItem(DENSITY_KEY, next); } catch { /* noop */ }
    setDensityState(next);
  };

  return { density, setDensity };
}

/** Segmented S / M / L control for the sidebar footer controls row. */
export function SidebarDensitySelector() {
  const { density, setDensity } = useDensity();

  return h("div", {
    class: "density-selector",
    role: "group",
    "aria-label": "UI density",
  },
    DENSITY_OPTIONS.map(({ value, label, aria }) =>
      h("button", {
        key: value,
        class: `density-btn${density === value ? " density-btn--active" : ""}`,
        onClick: () => setDensity(value),
        "aria-pressed": String(density === value),
        "aria-label": aria,
        title: aria,
      }, label),
    ),
  );
}
