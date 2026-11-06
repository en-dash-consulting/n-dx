/**
 * The area view's capability detail: the right-hand column's replacement while
 * a spec-map block is selected. It reads the capability the way its own page
 * does (`GET /api/rex/product/capability/<id>`) and renders the page's content
 * (`CapabilityBody`), pending amendments as before/after diffs included.
 *
 * Esc, or the back button, steps back to the area's column.
 *
 * @module viewer/views/area-capability
 */

import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useProductRead } from "../hooks/index.js";
import { CapabilityBody } from "./capability.js";
import type { CapabilityDetail } from "./product-model.js";

export interface AreaCapabilityProps {
  capabilityId: string;
  title: string;
  onClose: () => void;
}

export function AreaCapability({ capabilityId, title, onClose }: AreaCapabilityProps) {
  const load = useProductRead(
    `/api/rex/product/capability/${encodeURIComponent(capabilityId)}`,
    (body) => body.capability as CapabilityDetail,
  );
  const root = useRef<HTMLElement>(null);
  // Focus moves in so Esc reaches this column, not the tile around the area.
  useEffect(() => { root.current?.focus(); }, [capabilityId]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return h("aside", {
    ref: root,
    class: "area-cards area-capability",
    "aria-label": `Capability: ${title}`,
    tabIndex: -1,
    onKeyDown,
  },
    h("button", { type: "button", class: "cap-back area-capability-back", onClick: onClose }, "Area"),
    h("h3", { class: "area-capability-title" }, title),
    load.state === "loading"
      ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...")
      : load.state === "ready"
        ? h(CapabilityBody, { capability: load.data })
        : load.state === "error"
          ? h("div", { class: "empty-state", role: "alert" }, `Could not load the capability: ${load.message}`)
          : null,
  );
}
