import { h, Fragment, ComponentChildren } from "preact";
import { useState } from "preact/hooks";

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  threshold?: number;
  children?: ComponentChildren;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  threshold = 8,
  children,
}: CollapsibleSectionProps) {
  const raw = Array.isArray(children) ? children : children ? [children] : [];
  const items = raw.flat().filter(Boolean) as any[];
  const total = count ?? items.length;
  const needsCollapse = items.length > threshold;
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);

  const visibleItems = needsCollapse && !expanded ? items.slice(0, threshold) : items;
  const hiddenCount = items.length - threshold;

  return h("div", { class: "mb-16" },
    h("div", {
      class: "collapsible-header",
      onClick: () => setOpen(!open),
      role: "button",
      tabIndex: 0,
      "aria-expanded": String(open),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); }
      },
    },
      h("span", { class: `collapsible-chevron ${open ? "open" : ""}`, "aria-hidden": "true" }, "\u25B6"),
      h("span", { class: "collapsible-title" }, title),
      total > 0
        ? h("span", { class: "collapsible-count" }, String(total))
        : null,
    ),
    open
      ? h(Fragment, null,
          needsCollapse && expanded
            ? h("div", { class: "collapsible-scroll-container" },
                items,
                h("div", { class: "collapsible-sticky-footer" },
                  h("button", {
                    class: "collapsible-toggle",
                    onClick: () => setExpanded(false),
                  }, "Show less")
                )
              )
            : h(Fragment, null,
                visibleItems,
                needsCollapse
                  ? h("button", {
                      class: "collapsible-toggle",
                      onClick: () => setExpanded(true),
                    }, `Show ${hiddenCount} more`)
                  : null,
              ),
        )
      : null
  );
}
