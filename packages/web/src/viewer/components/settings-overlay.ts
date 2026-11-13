/**
 * Settings as a full overlay over the page, opened from the bottom bar's cog.
 *
 * Every settings page keeps its own route (`/robot-wrangler`, `/workflow`, …);
 * the overlay is what those routes look like. The page underneath stays
 * mounted, so closing returns to exactly where you were. The configuration
 * summary that used to sit in the sidebar footer heads the settings list.
 *
 * A page with sections lists them under its own entry in the nav
 * (`useSettingsSections`). The highlighted section follows the content's
 * scroll, and choosing one scrolls to it and focuses its heading. The page
 * stays one scroll, so it keeps one SettingsFrame and one leave guard.
 */

import { createContext, h } from "preact";
import { ActionIcon } from "./action-icon.js";
import type { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewId } from "../api.js";
import { SETTINGS_ENTRIES, useCliName, useStatusLayout, viewLabelFor, viewGlyph, viewPixelIcon } from "../api.js";
import { resolveCliLabel } from "../hooks/index.js";
import { PixelIcon } from "./pixel-icons.js";
import { ConfigFooter, type ServerIdentity } from "./config-footer.js";
import { SidebarDensitySelector } from "./density-selector.js";

export interface SettingsOverlayProps {
  view: ViewId;
  validViews: ReadonlySet<ViewId>;
  onNavigate: (view: ViewId) => void;
  onClose: () => void;
  server?: ServerIdentity | null;
  /**
   * The active settings view, rendered by the registry. Optional in the type
   * because `h()` passes children as its third argument.
   */
  children?: ComponentChildren;
}

/** One section of a settings page, as the nav lists it. */
export interface SettingsSection {
  id: string;
  title: string;
}

/** The element id a section's `<section>` carries, which the nav scrolls to. */
export const settingsSectionAnchor = (id: string): string => `settings-section-${id}`;

const SectionsContext = createContext<((sections: readonly SettingsSection[] | null) => void) | null>(null);

/**
 * List the page's sections in the overlay nav, under its entry, for as long as
 * the page is mounted. Each section's element must carry
 * `settingsSectionAnchor(id)` as its id. Outside the overlay it does nothing.
 */
export function useSettingsSections(sections: readonly SettingsSection[]): void {
  const publish = useContext(SectionsContext);
  const signature = sections.map((s) => `${s.id}\u0000${s.title}`).join("\u0001");
  useEffect(() => {
    if (!publish) return undefined;
    publish(sections);
    return () => publish(null);
    // `signature` stands for `sections`: a new array with the same entries is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, signature]);
}

/** A section is current once its top is this close to the top of the content. */
const SPY_OFFSET_PX = 96;

/** True while the section's heading is inside the content's visible area. */
function headingInView(content: HTMLElement, id: string): boolean {
  const el = document.getElementById(settingsSectionAnchor(id));
  if (!el) return false;
  const box = content.getBoundingClientRect();
  const top = el.getBoundingClientRect().top;
  return top >= box.top - 1 && top < box.bottom;
}

/** The section the reader is in: the last one whose top has reached the offset line. */
function currentSection(content: HTMLElement, sections: readonly SettingsSection[]): string | null {
  if (sections.length === 0) return null;
  if (content.scrollTop <= 0) return sections[0]!.id;
  // Scrolled to the bottom, the last section is current even if its top never reaches the line.
  const scrollable = content.scrollHeight > content.clientHeight;
  if (scrollable && content.scrollTop + content.clientHeight >= content.scrollHeight - 2) {
    return sections[sections.length - 1]!.id;
  }
  const line = content.getBoundingClientRect().top + SPY_OFFSET_PX;
  let current = sections[0]!.id;
  for (const section of sections) {
    const el = document.getElementById(settingsSectionAnchor(section.id));
    if (el && el.getBoundingClientRect().top <= line) current = section.id;
  }
  return current;
}

export function SettingsOverlay({ view, validViews, onNavigate, onClose, server = null, children }: SettingsOverlayProps) {
  const cliName = useCliName();
  const layout = useStatusLayout();
  const [sections, setSections] = useState<readonly SettingsSection[] | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /**
   * The section last jumped to from the nav. Near the end of the page its top
   * may never reach the offset line, so it stays current while its heading is
   * in view rather than yielding to the last section.
   */
  const jumpedRef = useRef<string | null>(null);

  const entries = useMemo(() => SETTINGS_ENTRIES
    .filter((e) => validViews.has(e.view))
    .map((e) => ({
      view: e.view,
      glyph: viewGlyph(e.view),
      pixelIcon: viewPixelIcon(e.view),
      label: resolveCliLabel(viewLabelFor(e.view, layout), cliName),
    })), [validViews, cliName, layout]);

  const current = entries.find((e) => e.view === view);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The highlight follows the content's scroll, at most once a frame.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !sections || sections.length === 0) {
      setActiveSection(null);
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const jumped = jumpedRef.current;
      if (jumped && sections.some((s) => s.id === jumped) && headingInView(content, jumped)) {
        setActiveSection(jumped);
        return;
      }
      jumpedRef.current = null;
      setActiveSection(currentSection(content, sections));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    content.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      content.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(settingsSectionAnchor(id));
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    el.querySelector<HTMLElement>("h2, h3")?.focus({ preventScroll: true });
    jumpedRef.current = id;
    setActiveSection(id);
  }, []);

  return h("section", {
    class: "settings-overlay",
    id: "settings-overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Settings",
  },
    h("div", { class: "settings-overlay-head" },
      h("span", { class: "settings-overlay-glyph", "aria-hidden": "true" },
        h(PixelIcon, { name: "settings", variant: "glyph", size: 22 })),
      h("div", { class: "settings-overlay-crumbs" },
        "Settings",
        current ? h("span", { class: "settings-overlay-sep", "aria-hidden": "true" }, " / ") : null,
        current ? h("b", null, current.label) : null,
      ),
      h("button", {
        type: "button",
        class: "settings-overlay-close",
        onClick: onClose,
        "aria-label": "Close settings",
        title: "Close (Esc)",
      }, h(ActionIcon, { name: "close" })),
    ),
    h("div", { class: "settings-overlay-body" },
      h("nav", { class: "settings-overlay-nav", "aria-label": "Settings pages" },
        h("div", { class: "settings-overlay-summary" }, h(ConfigFooter, { server })),
        entries.map((e) => [
          h("button", {
            key: e.view,
            type: "button",
            class: `settings-overlay-item${e.view === view ? " active" : ""}`,
            onClick: () => onNavigate(e.view),
            "aria-current": e.view === view ? "page" : undefined,
          },
            h("span", { class: "settings-overlay-item-glyph", "aria-hidden": "true" },
              e.pixelIcon ? h(PixelIcon, { name: e.pixelIcon, variant: "glyph", size: 22 }) : e.glyph),
            e.label,
          ),
          e.view === view && sections && sections.length > 0
            ? h("ul", { key: `${e.view}-sections`, class: "settings-overlay-sections", "aria-label": `${e.label} sections` },
                sections.map((s) =>
                  h("li", { key: s.id },
                    h("button", {
                      type: "button",
                      class: `settings-overlay-section${s.id === activeSection ? " active" : ""}`,
                      "aria-current": s.id === activeSection ? "location" : undefined,
                      onClick: () => jumpTo(s.id),
                    }, s.title),
                  )),
              )
            : null,
        ]),
        h("div", { class: "settings-overlay-density" },
          h("span", { class: "settings-overlay-density-label" }, "Density"),
          h(SidebarDensitySelector, null),
        ),
      ),
      h("div", { class: "settings-overlay-content", ref: contentRef },
        h(SectionsContext.Provider, { value: setSections }, children),
      ),
    ),
  );
}
