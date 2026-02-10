import { h } from "preact";
import { useState } from "preact/hooks";

export function initTheme() {
  const stored = localStorage.getItem("sv-theme");
  const preferred =
    stored || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", preferred);
}

function useThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sv-theme", next);
    setTheme(next);
  };

  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useThemeToggle();

  return h("button", {
    class: "theme-toggle-btn",
    onClick: toggle,
    title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
    "aria-label": theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  }, theme === "dark" ? "\u2600" : "\u263E");
}

/** Theme toggle styled for the sidebar controls area */
export function SidebarThemeToggle() {
  const { theme, toggle } = useThemeToggle();

  return h("button", {
    class: "sidebar-control-btn",
    onClick: toggle,
    title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
    "aria-label": theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  }, theme === "dark" ? "\u2600" : "\u263E");
}
