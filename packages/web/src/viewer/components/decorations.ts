/**
 * Geometric decoration primitives — reusable SVG/HTML components for the
 * ndx dashboard design system.
 *
 * All components are absolutely-positioned, pointer-events:none overlays.
 * Place them as direct children of a `position:relative` container.
 *
 * ALLOWED vocabulary:  dot grids · concentric arcs · thin border circles ·
 *                      ruled lines · oversized numerals · geometric strokes
 * DISALLOWED:          raster images · emoji · clip-path blobs ·
 *                      gradient colour splashes · glow/drop-shadow filters ·
 *                      external assets
 *
 * CSS tokens consumed (from decorations.css):
 *   --deco-stroke-thin   --deco-stroke-thick
 *   --deco-stroke-color  --deco-dot-color  --deco-line-color
 *   --deco-opacity-ghost --deco-opacity-faint --deco-opacity-subtle
 *   --deco-z-bg          --deco-z-content
 */

import { h } from "preact";

/* ── DecoConcentricArcs ─────────────────────────────────────────── */

export interface DecoConcentricArcsProps {
  /** Outer arc radius in px (default 140) */
  size?: number;
  /** Corner anchor: "br" | "bl" | "tr" | "tl" (default "br") */
  corner?: "br" | "bl" | "tr" | "tl";
  /** SVG stroke color (default "white"; override for light theme) */
  color?: string;
  /** Number of concentric arcs 2–4 (default 3) */
  count?: number;
  class?: string;
}

/**
 * Concentric quarter-circle arc set, anchored to a container corner.
 * Renders as an inline SVG absolute overlay.
 */
export function DecoConcentricArcs({
  size = 140,
  corner = "br",
  color = "white",
  count = 3,
  class: cls,
}: DecoConcentricArcsProps) {
  const offsets: Record<string, Record<string, string>> = {
    br: { right: "-24px", bottom: "-24px" },
    bl: { left: "-24px", bottom: "-24px" },
    tr: { right: "-24px", top: "-24px" },
    tl: { left: "-24px", top: "-24px" },
  };

  const radii = Array.from({ length: count }, (_, i) =>
    Math.round(size - i * (size / (count + 1)))
  );

  const arc = (r: number, idx: number) => {
    const opacity = String((0.09 - idx * 0.02).toFixed(2));
    let d: string;
    switch (corner) {
      case "bl": d = `M0,0 A${r},${r} 0 0,0 ${r},${r}`; break;
      case "tr": d = `M0,${r} A${r},${r} 0 0,1 ${r},0`; break;
      case "tl": d = `M${r},0 A${r},${r} 0 0,0 0,${r}`; break;
      default:   d = `M${r},0 A${r},${r} 0 0,1 0,${r}`; break; // "br"
    }
    return h("path", {
      key: idx,
      d,
      fill: "none",
      stroke: color,
      "stroke-width": "1",
      opacity,
    });
  };

  return h("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    class: cls,
    "aria-hidden": "true",
    style: {
      position: "absolute",
      pointerEvents: "none",
      zIndex: "0",
      ...offsets[corner],
    },
  }, ...radii.map((r, i) => arc(r, i)));
}

/* ── DecoDotGrid ────────────────────────────────────────────────── */

export interface DecoDotGridProps {
  /** Dot spacing in px (default 24) */
  spacing?: number;
  /** Dot radius in px (default 1.5) */
  radius?: number;
  class?: string;
}

/**
 * Full-cover dot grid using an inline SVG `<pattern>`.
 * Stretches to fill the parent (position:relative required on parent).
 */
export function DecoDotGrid({
  spacing = 24,
  radius = 1.5,
  class: cls,
}: DecoDotGridProps) {
  const id = `dg-${spacing}-${Math.round(radius * 10)}`;
  return h("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "100%",
    height: "100%",
    class: cls,
    "aria-hidden": "true",
    style: {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "0",
    },
  },
    h("defs", {},
      h("pattern", {
        id,
        width: spacing,
        height: spacing,
        patternUnits: "userSpaceOnUse",
      },
        h("circle", {
          cx: spacing / 2,
          cy: spacing / 2,
          r: radius,
          fill: "var(--deco-dot-color)",
        }),
      ),
    ),
    h("rect", { width: "100%", height: "100%", fill: `url(#${id})` }),
  );
}

/* ── DecoBorderCircle ───────────────────────────────────────────── */

export interface DecoBorderCircleProps {
  /** Diameter in px (default 160) */
  size?: number;
  /**
   * Offset from the anchor corner in px.
   * Negative values push the circle partially outside the container (default -50).
   */
  offset?: number;
  /** Corner anchor (default "tr") */
  corner?: "tr" | "tl" | "br" | "bl";
  class?: string;
}

/**
 * A thin-border circle anchored to a container corner.
 * Partially clips out of the container for a clean geometric accent.
 */
export function DecoBorderCircle({
  size = 160,
  offset = -50,
  corner = "tr",
  class: cls,
}: DecoBorderCircleProps) {
  const pos: Record<string, string> = {};
  if (corner.includes("t")) pos["top"] = `${offset}px`;
  if (corner.includes("b")) pos["bottom"] = `${offset}px`;
  if (corner.includes("r")) pos["right"] = `${offset}px`;
  if (corner.includes("l")) pos["left"] = `${offset}px`;

  return h("span", {
    "aria-hidden": "true",
    class: cls,
    style: {
      position: "absolute",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      border: "var(--deco-stroke-thin, 1px) solid var(--deco-stroke-color)",
      pointerEvents: "none",
      zIndex: "0",
      ...pos,
    },
  });
}

/* ── DecoRuledLines ─────────────────────────────────────────────── */

export interface DecoRuledLinesProps {
  /** "horizontal" (default) or "vertical" */
  direction?: "horizontal" | "vertical";
  /** Line spacing in px (default 24) */
  spacing?: number;
  class?: string;
}

/**
 * Full-cover ruled-line pattern using a repeating CSS gradient.
 * Stretches to fill the parent (position:relative required on parent).
 */
export function DecoRuledLines({
  direction = "horizontal",
  spacing = 24,
  class: cls,
}: DecoRuledLinesProps) {
  const isH = direction === "horizontal";
  const axis = isH ? "to bottom" : "to right";
  const grad =
    `repeating-linear-gradient(${axis}, transparent, transparent ${spacing - 1}px, ` +
    `var(--deco-line-color) ${spacing - 1}px, var(--deco-line-color) ${spacing}px)`;

  return h("span", {
    "aria-hidden": "true",
    class: cls,
    style: {
      position: "absolute",
      inset: "0",
      backgroundImage: grad,
      pointerEvents: "none",
      zIndex: "0",
    },
  });
}

/* ── DecoLargeNumeral ───────────────────────────────────────────── */

export interface DecoLargeNumeralProps {
  /** The numeral string to display (e.g. "01", "02") */
  value: string;
  /** Font size in px (default 96) */
  fontSize?: number;
  /** Corner anchor (default "br") */
  corner?: "br" | "bl" | "tr" | "tl";
  class?: string;
}

/**
 * Oversized background numeral rendered as a purely typographic element.
 * Used for section numbering and visual rhythm — not semantic content.
 */
export function DecoLargeNumeral({
  value,
  fontSize = 96,
  corner = "br",
  class: cls,
}: DecoLargeNumeralProps) {
  const pos: Record<string, string> = {};
  if (corner.includes("b")) pos["bottom"] = "-4px";
  if (corner.includes("t")) pos["top"] = "-4px";
  if (corner.includes("r")) pos["right"] = "12px";
  if (corner.includes("l")) pos["left"] = "12px";

  return h("span", {
    "aria-hidden": "true",
    class: cls,
    style: {
      position: "absolute",
      fontSize: `${fontSize}px`,
      fontWeight: "900",
      letterSpacing: "-0.06em",
      lineHeight: "1",
      fontVariantNumeric: "tabular-nums",
      color: "var(--text)",
      opacity: "var(--deco-opacity-ghost, 0.04)",
      pointerEvents: "none",
      zIndex: "0",
      userSelect: "none",
      ...pos,
    },
  }, value);
}
