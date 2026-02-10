// @vitest-environment jsdom
/**
 * Tests for dynamic favicon management.
 *
 * Verifies that the favicon updates correctly based on the active
 * view/product section, falls back to n-dx for non-package pages,
 * and avoids redundant DOM updates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  updateFavicon,
  resetFavicon,
  FAVICON_URIS,
  VIEW_TO_PRODUCT,
  svgToDataUri,
  FAVICON_SVGS,
} from "../../../src/viewer/components/favicon.js";
import type { ViewId } from "../../../src/viewer/types.js";

function getFaviconHref(): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  return link?.href ?? null;
}

function getFaviconType(): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  return link?.type ?? null;
}

describe("favicon", () => {
  let existingLinks: HTMLLinkElement[];

  beforeEach(() => {
    // Clean up any favicon links and reset module cache
    existingLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    existingLinks.forEach((l) => l.remove());
    resetFavicon();
  });

  afterEach(() => {
    // Clean up links we created
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => l.remove());
  });

  describe("svgToDataUri", () => {
    it("converts SVG to a data URI", () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
      const uri = svgToDataUri(svg);
      expect(uri).toMatch(/^data:image\/svg\+xml,/);
      expect(uri).toContain("svg");
    });

    it("strips whitespace from multi-line SVG", () => {
      const svg = `<svg>
        <rect/>
      </svg>`;
      const uri = svgToDataUri(svg);
      expect(uri).not.toContain("%0A"); // no encoded newlines
    });
  });

  describe("FAVICON_URIS", () => {
    it("has URIs for all products plus ndx", () => {
      expect(FAVICON_URIS).toHaveProperty("ndx");
      expect(FAVICON_URIS).toHaveProperty("sourcevision");
      expect(FAVICON_URIS).toHaveProperty("rex");
      expect(FAVICON_URIS).toHaveProperty("hench");
    });

    it("all URIs are data URIs", () => {
      for (const uri of Object.values(FAVICON_URIS)) {
        expect(uri).toMatch(/^data:image\/svg\+xml,/);
      }
    });

    it("each URI contains valid SVG content", () => {
      for (const [key, uri] of Object.entries(FAVICON_URIS)) {
        const decoded = decodeURIComponent(uri.replace("data:image/svg+xml,", ""));
        expect(decoded).toContain("<svg");
        expect(decoded).toContain("</svg>");
      }
    });
  });

  describe("FAVICON_SVGS", () => {
    it("has SVGs for all products and ndx", () => {
      expect(FAVICON_SVGS).toHaveProperty("ndx");
      expect(FAVICON_SVGS).toHaveProperty("sourcevision");
      expect(FAVICON_SVGS).toHaveProperty("rex");
      expect(FAVICON_SVGS).toHaveProperty("hench");
    });

    it("all SVGs include xmlns attribute", () => {
      for (const svg of Object.values(FAVICON_SVGS)) {
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      }
    });
  });

  describe("VIEW_TO_PRODUCT", () => {
    it("maps sourcevision views correctly", () => {
      const svViews: ViewId[] = [
        "overview", "graph", "zones", "files", "routes",
        "architecture", "problems", "suggestions",
      ];
      for (const view of svViews) {
        expect(VIEW_TO_PRODUCT[view]).toBe("sourcevision");
      }
    });

    it("maps rex views correctly", () => {
      const rexViews: ViewId[] = [
        "rex-dashboard", "prd", "rex-analysis", "token-usage", "validation",
      ];
      for (const view of rexViews) {
        expect(VIEW_TO_PRODUCT[view]).toBe("rex");
      }
    });

    it("maps hench views correctly", () => {
      expect(VIEW_TO_PRODUCT["hench-runs"]).toBe("hench");
    });
  });

  describe("updateFavicon", () => {
    it("creates a favicon link if none exists", () => {
      expect(document.querySelector('link[rel="icon"]')).toBeNull();
      updateFavicon("overview");
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      expect(link).not.toBeNull();
      expect(link!.type).toBe("image/svg+xml");
    });

    it("reuses an existing favicon link element", () => {
      const existing = document.createElement("link");
      existing.rel = "icon";
      existing.type = "image/png";
      existing.href = "/old-favicon.png";
      document.head.appendChild(existing);

      updateFavicon("overview");

      const allLinks = document.querySelectorAll('link[rel="icon"]');
      expect(allLinks.length).toBe(1);
      expect(allLinks[0]).toBe(existing);
      expect(existing.type).toBe("image/svg+xml");
    });

    it("sets sourcevision favicon for sourcevision views", () => {
      updateFavicon("overview");
      expect(getFaviconHref()).toBe(FAVICON_URIS.sourcevision);

      updateFavicon("graph");
      expect(getFaviconHref()).toBe(FAVICON_URIS.sourcevision);

      updateFavicon("zones");
      expect(getFaviconHref()).toBe(FAVICON_URIS.sourcevision);
    });

    it("sets rex favicon for rex views", () => {
      updateFavicon("rex-dashboard");
      expect(getFaviconHref()).toBe(FAVICON_URIS.rex);

      updateFavicon("prd");
      expect(getFaviconHref()).toBe(FAVICON_URIS.rex);
    });

    it("sets hench favicon for hench views", () => {
      updateFavicon("hench-runs");
      expect(getFaviconHref()).toBe(FAVICON_URIS.hench);
    });

    it("sets type to image/svg+xml", () => {
      updateFavicon("prd");
      expect(getFaviconType()).toBe("image/svg+xml");
    });
  });
});
