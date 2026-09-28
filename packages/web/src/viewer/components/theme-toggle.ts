import { h } from "preact";
import { useState } from "preact/hooks";

/**
 * Theme: System (default) · Light · Dark.
 *
 * Every stylesheet keys on `data-theme` on <html>, so "system" is not left to a
 * CSS media query: it resolves to "light" or "dark" here and keeps tracking the
 * OS setting while the page is open. Light and Dark pin the attribute. The
 * choice is stored under `sv-theme` (the key the pre-paint script in
 * index.html also reads); "system" is stored as nothing.
 */

export type ThemePref = "system" | "light" | "dark";

const THEME_KEY = "sv-theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): "light" | "dark" {
  try {
    return matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyPref(pref: ThemePref): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", pref === "system" ? systemTheme() : pref);
  root.setAttribute("data-theme-pref", pref);
}

function storePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch { /* storage unavailable — the choice lasts for this page */ }
}

let listening = false;

/** Apply the stored preference and follow OS changes while on "system". */
export function initTheme() {
  applyPref(readPref());
  if (listening) return;
  try {
    const mql = matchMedia(LIGHT_QUERY);
    mql.addEventListener?.("change", () => {
      if (readPref() === "system") applyPref("system");
    });
    listening = true;
  } catch { /* no matchMedia (tests, very old engines) — system resolves once */ }
}

const OPTIONS: ReadonlyArray<{ value: ThemePref; glyph: string; label: string; title: string }> = [
  { value: "system", glyph: "◐", label: "System theme", title: "System: follow the OS setting" },
  { value: "light", glyph: "☀", label: "Light theme", title: "Light" },
  { value: "dark", glyph: "☾", label: "Dark theme", title: "Dark" },
];

/**
 * Segmented System / Light / Dark control for the bottom bar. Icons only —
 * each button's name comes from its aria-label, and its tooltip says what it does.
 */
export function ThemeToggle() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);

  const choose = (next: ThemePref) => {
    storePref(next);
    applyPref(next);
    setPrefState(next);
  };

  return h("div", { class: "theme-toggle", role: "group", "aria-label": "Theme" },
    OPTIONS.map((o) =>
      h("button", {
        key: o.value,
        type: "button",
        class: `theme-toggle-btn${pref === o.value ? " theme-toggle-btn--active" : ""}`,
        "data-theme-pref": o.value,
        "aria-pressed": String(pref === o.value),
        "aria-label": o.label,
        title: o.title,
        onClick: () => choose(o.value),
      },
        h("span", { class: "theme-toggle-glyph", "aria-hidden": "true" }, o.glyph),
      ),
    ),
  );
}
