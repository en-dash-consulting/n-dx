// @vitest-environment jsdom
/**
 * Tests for dynamic favicon management.
 *
 * Verifies that the favicon updates correctly based on the active
 * view/product section using PNG favicons, falls back to n-dx for
 * non-package pages, and avoids redundant DOM updates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  updateFavicon,
  resetFavicon,
  FAVICON_PNGS,
  VIEW_TO_PRODUCT,
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

  describe("FAVICON_PNGS", () => {
    it("has PNG paths for all products plus ndx", () => {
      expect(FAVICON_PNGS).toHaveProperty("ndx");
      expect(FAVICON_PNGS).toHaveProperty("sourcevision");
      expect(FAVICON_PNGS).toHaveProperty("rex");
      expect(FAVICON_PNGS).toHaveProperty("hench");
    });

    it("all paths are PNG file references", () => {
      for (const path of Object.values(FAVICON_PNGS)) {
        expect(path).toMatch(/\.png$/);
      }
    });

    it("ndx favicon points to n-dx.png", () => {
      expect(FAVICON_PNGS.ndx).toBe("/n-dx.png");
    });

    it("product favicons use -F.png naming convention", () => {
      expect(FAVICON_PNGS.sourcevision).toBe("/SourceVision-F.png");
      expect(FAVICON_PNGS.rex).toBe("/Rex-F.png");
      expect(FAVICON_PNGS.hench).toBe("/Hench-F.png");
    });
  });

  describe("VIEW_TO_PRODUCT", () => {
    it("maps sourcevision views correctly", () => {
      const svViews: ViewId[] = [
        "overview", "graph", "zones", "files", "routes",
        "architecture", "problems", "suggestions", "pr-markdown",
      ];
      for (const view of svViews) {
        expect(VIEW_TO_PRODUCT[view]).toBe("sourcevision");
      }
    });

    it("maps rex views correctly", () => {
      const rexViews: ViewId[] = [
        "rex-dashboard", "prd", "rex-analysis", "validation",
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
      expect(link!.type).toBe("image/png");
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
      expect(existing.type).toBe("image/png");
    });

    it("sets sourcevision favicon for sourcevision views", () => {
      updateFavicon("overview");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.sourcevision);

      updateFavicon("graph");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.sourcevision);

      updateFavicon("zones");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.sourcevision);
    });

    it("sets rex favicon for rex views", () => {
      updateFavicon("rex-dashboard");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.rex);

      updateFavicon("prd");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.rex);
    });

    it("sets hench favicon for hench views", () => {
      updateFavicon("hench-runs");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.hench);
    });

    it("sets type to image/png", () => {
      updateFavicon("prd");
      expect(getFaviconType()).toBe("image/png");
    });

    it("uses n-dx favicon for global token usage view", () => {
      updateFavicon("token-usage");
      expect(getFaviconHref()).toContain(FAVICON_PNGS.ndx);
    });

    it("falls back to n-dx favicon for unmapped views", () => {
      // Cast to ViewId to test fallback behavior for a view not in VIEW_TO_PRODUCT
      updateFavicon("unknown-view" as ViewId);
      expect(getFaviconHref()).toContain(FAVICON_PNGS.ndx);
    });
  });
});
