/**
 * Dynamic favicon management.
 *
 * Generates inline SVG favicons for each product section and swaps
 * the <link rel="icon"> element when the active view changes.
 * Falls back to the n-dx logo on non-package-specific pages.
 */

import type { ViewId } from "../types.js";

type Product = "sourcevision" | "rex" | "hench";

/* ── SVG favicon templates ──
 *
 * Standalone SVG strings (not Preact VNodes) designed to work as
 * 32x32 favicons. Each mirrors the inline logo from logos.ts but
 * uses explicit color values instead of CSS custom properties
 * (favicons don't inherit page styles).
 */

const FAVICON_SVGS: Record<Product | "ndx", string> = {
  /** n-dx — serif "en" on navy background with teal underline */
  ndx: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 36 36">
    <rect width="36" height="36" rx="6" fill="#001769"/>
    <text x="18" y="24" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="18" font-weight="700" fill="#ffffff" letter-spacing="-0.5">en</text>
    <rect x="5" y="28" width="26" height="2.5" rx="1" fill="#00E5B9"/>
  </svg>`,

  /** SourceVision — eye/lens icon on teal background */
  sourcevision: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 20 20">
    <rect width="20" height="20" rx="4" fill="#006B56"/>
    <g fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 10s3.5-6 8-6 8 6 8 6-3.5 6-8 6-8-6-8-6Z"/>
      <circle cx="10" cy="10" r="3"/>
      <line x1="10" y1="4" x2="10" y2="6" stroke="#00E5B9" stroke-width="1.5"/>
      <line x1="10" y1="14" x2="10" y2="16" stroke="#00E5B9" stroke-width="1.5"/>
    </g>
  </svg>`,

  /** Rex — crown icon on purple background */
  rex: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 20 20">
    <rect width="20" height="20" rx="4" fill="#4A2DB8"/>
    <g fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 14l2-8 3 4 2-6 2 6 3-4 2 8z" fill="rgba(255,255,255,0.2)"/>
      <path d="M3 14l2-8 3 4 2-6 2 6 3-4 2 8z"/>
      <rect x="3" y="14" width="14" height="2.5" rx="1" fill="rgba(255,255,255,0.3)"/>
      <rect x="3" y="14" width="14" height="2.5" rx="1" fill="none"/>
    </g>
  </svg>`,

  /** Hench — robot icon on orange background */
  hench: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 20 20">
    <rect width="20" height="20" rx="4" fill="#CC4520"/>
    <g fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="3" width="12" height="10" rx="2"/>
      <circle cx="8" cy="8" r="1.2" fill="#ffffff"/>
      <circle cx="12" cy="8" r="1.2" fill="#ffffff"/>
      <line x1="10" y1="3" x2="10" y2="1"/>
      <circle cx="10" cy="0.5" r="0.8" fill="#00E5B9" stroke="none"/>
      <rect x="5" y="14" width="10" height="4" rx="1.5"/>
      <line x1="10" y1="13" x2="10" y2="14"/>
    </g>
  </svg>`,
};

/** Convert an SVG string to a data URI suitable for a favicon href. */
function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, ""))}`;
}

/** Pre-computed data URIs — built once, reused on every navigation. */
const FAVICON_URIS: Record<Product | "ndx", string> = {
  ndx: svgToDataUri(FAVICON_SVGS.ndx),
  sourcevision: svgToDataUri(FAVICON_SVGS.sourcevision),
  rex: svgToDataUri(FAVICON_SVGS.rex),
  hench: svgToDataUri(FAVICON_SVGS.hench),
};

/**
 * Map from ViewId → the product that owns it.
 * Views not in this map default to the n-dx favicon.
 */
const VIEW_TO_PRODUCT: Partial<Record<ViewId, Product>> = {
  overview: "sourcevision",
  graph: "sourcevision",
  zones: "sourcevision",
  files: "sourcevision",
  routes: "sourcevision",
  architecture: "sourcevision",
  problems: "sourcevision",
  suggestions: "sourcevision",
  "rex-dashboard": "rex",
  prd: "rex",
  "rex-analysis": "rex",
  "token-usage": "rex",
  validation: "rex",
  "hench-runs": "hench",
};

/** Cached reference to the <link rel="icon"> element. */
let faviconLink: HTMLLinkElement | null = null;

function getFaviconLink(): HTMLLinkElement {
  if (faviconLink) return faviconLink;

  // Look for existing favicon link
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) {
    faviconLink = existing;
    return faviconLink;
  }

  // Create one if missing (shouldn't happen in practice)
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  document.head.appendChild(link);
  faviconLink = link;
  return faviconLink;
}

/** Track current favicon to avoid redundant DOM updates. */
let currentProduct: Product | "ndx" | null = null;

/**
 * Update the browser favicon to match the active view's product section.
 *
 * Call this whenever the view changes. It determines the owning product
 * from the ViewId and swaps the favicon accordingly. Non-package views
 * (if any) fall back to the n-dx logo.
 */
export function updateFavicon(view: ViewId): void {
  const product = VIEW_TO_PRODUCT[view] ?? "ndx";
  if (product === currentProduct) return;

  currentProduct = product;
  const link = getFaviconLink();
  link.type = "image/svg+xml";
  link.href = FAVICON_URIS[product];
}

/**
 * Reset internal cache. Call between tests to avoid stale references
 * when the DOM is torn down and rebuilt.
 */
export function resetFavicon(): void {
  faviconLink = null;
  currentProduct = null;
}

/** Exported for testing. */
export { FAVICON_SVGS, FAVICON_URIS, VIEW_TO_PRODUCT, svgToDataUri };
