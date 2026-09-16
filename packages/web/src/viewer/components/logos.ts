/**
 * PNG-based logo components for n-dx and its sub-products.
 *
 * The original SVG logo components (NdxLogo, SourceVisionLogo, RexLogo,
 * HenchLogo) were replaced by PNG versions for better visual fidelity.
 */

import { appUrl } from "../base-path.js";
import { h } from "preact";

interface LogoProps {
  size?: number;
  class?: string;
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
    src: appUrl("/n-dx.png"),
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
