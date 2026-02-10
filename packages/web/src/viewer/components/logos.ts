/**
 * Inline SVG logos for n-dx and its sub-products.
 *
 * These render as Preact VNodes so they inline directly in the bundle
 * (no external PNG dependency). Each logo accepts a `size` prop and
 * respects CSS custom properties for theming.
 */

import { h } from "preact";

interface LogoProps {
  size?: number;
  class?: string;
}

/**
 * n-dx main logo — "en" serif letters with teal underline accent.
 * Uses brand-navy bg in light mode, brand-purple bg in dark mode.
 */
export function NdxLogo({ size = 36, class: cls }: LogoProps) {
  return h("svg", {
    width: size,
    height: size,
    viewBox: "0 0 36 36",
    class: `logo logo-ndx${cls ? ` ${cls}` : ""}`,
    "aria-hidden": "true",
    role: "img",
  },
    h("rect", { width: 36, height: 36, rx: 6, class: "logo-ndx-bg" }),
    // "en" letterforms — simplified serif representation
    h("text", {
      x: 18,
      y: 24,
      "text-anchor": "middle",
      "font-family": "Georgia, 'Times New Roman', serif",
      "font-size": "18",
      "font-weight": "700",
      fill: "#ffffff",
      "letter-spacing": "-0.5",
    }, "en"),
    // Teal underline accent
    h("rect", { x: 5, y: 28, width: 26, height: 2.5, rx: 1, fill: "var(--brand-teal)" }),
  );
}

/**
 * SourceVision logo — eye/lens icon representing code analysis.
 */
export function SourceVisionLogo({ size = 20, class: cls }: LogoProps) {
  return h("svg", {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    class: `logo logo-sv${cls ? ` ${cls}` : ""}`,
    "aria-hidden": "true",
    role: "img",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  },
    // Outer eye shape
    h("path", { d: "M2 10s3.5-6 8-6 8 6 8 6-3.5 6-8 6-8-6-8-6Z" }),
    // Inner iris
    h("circle", { cx: 10, cy: 10, r: 3 }),
    // Scan line
    h("line", { x1: 10, y1: 4, x2: 10, y2: 6, stroke: "var(--brand-teal)", "stroke-width": "1.5" }),
    h("line", { x1: 10, y1: 14, x2: 10, y2: 16, stroke: "var(--brand-teal)", "stroke-width": "1.5" }),
  );
}

/**
 * Rex logo — crown icon representing PRD management.
 */
export function RexLogo({ size = 20, class: cls }: LogoProps) {
  return h("svg", {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    class: `logo logo-rex${cls ? ` ${cls}` : ""}`,
    "aria-hidden": "true",
    role: "img",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  },
    // Crown shape
    h("path", { d: "M3 14l2-8 3 4 2-6 2 6 3-4 2 8z", fill: "currentColor", opacity: "0.15" }),
    h("path", { d: "M3 14l2-8 3 4 2-6 2 6 3-4 2 8z" }),
    // Base band
    h("rect", { x: 3, y: 14, width: 14, height: 2.5, rx: 1, fill: "currentColor", opacity: "0.25" }),
    h("rect", { x: 3, y: 14, width: 14, height: 2.5, rx: 1, fill: "none" }),
  );
}

/**
 * Hench logo — robot/agent icon representing autonomous execution.
 */
export function HenchLogo({ size = 20, class: cls }: LogoProps) {
  return h("svg", {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    class: `logo logo-hench${cls ? ` ${cls}` : ""}`,
    "aria-hidden": "true",
    role: "img",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  },
    // Head/screen
    h("rect", { x: 4, y: 3, width: 12, height: 10, rx: 2 }),
    // Eyes
    h("circle", { cx: 8, cy: 8, r: 1.2, fill: "currentColor" }),
    h("circle", { cx: 12, cy: 8, r: 1.2, fill: "currentColor" }),
    // Antenna
    h("line", { x1: 10, y1: 3, x2: 10, y2: 1 }),
    h("circle", { cx: 10, cy: 0.5, r: 0.8, fill: "var(--brand-teal)", stroke: "none" }),
    // Body
    h("rect", { x: 5, y: 14, width: 10, height: 4, rx: 1.5 }),
    // Neck
    h("line", { x1: 10, y1: 13, x2: 10, y2: 14 }),
  );
}

/* ── PNG-based logo components ── */

const PRODUCT_PNG: Record<string, string> = {
  sourcevision: "/SourceVision-F.png",
  rex: "/Rex-F.png",
  hench: "/Hench-F.png",
};

/** PNG logo for n-dx brand mark */
export function NdxLogoPng({ size = 36, class: cls }: LogoProps) {
  return h("img", {
    src: "/n-dx.png",
    width: size,
    height: size,
    alt: "",
    "aria-hidden": "true",
    class: `logo logo-ndx-png${cls ? ` ${cls}` : ""}`,
  });
}

/** PNG logo for a product section (sourcevision, rex, hench) */
export function ProductLogoPng({ product, size = 20, class: cls }: LogoProps & { product: string }) {
  const src = PRODUCT_PNG[product];
  if (!src) return null;
  return h("img", {
    src,
    width: size,
    height: size,
    alt: "",
    "aria-hidden": "true",
    class: `logo logo-product-png${cls ? ` ${cls}` : ""}`,
  });
}

/**
 * Renders a branded section header with a product logo and title.
 * Used in both the sidebar (compact mode) and view page headers (full mode).
 */
export function BrandedHeader({ product, title, class: cls }: {
  product: "sourcevision" | "rex" | "hench";
  title: string;
  class?: string;
}) {
  return h("div", { class: `branded-header${cls ? ` ${cls}` : ""}` },
    h(ProductLogoPng, { product, size: 16, class: "branded-header-logo" }),
    h("span", { class: "branded-header-label" }, title),
  );
}
