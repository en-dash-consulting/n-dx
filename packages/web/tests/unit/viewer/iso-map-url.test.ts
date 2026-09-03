/**
 * Isometric-map URL construction.
 *
 * `buildIsoMapUrl` is the single place where control state becomes a request
 * for `GET /api/iso-map`.
 *
 * The round trip against the route's own parser lives in
 * `tests/unit/server/routes-iso-map.test.ts`, next to `parseIsoParams` — this
 * file stays free of server imports so it runs in every environment.
 */
import { describe, it, expect } from "vitest";
import {
  ISO_MAP_DEFAULTS,
  ISO_MAP_ENDPOINT,
  ISO_MAP_MAX_NODES,
  ISO_MAP_MIN_NODES,
  buildIsoMapUrl,
  clampMaxNodes,
  isIsoMapSource,
  isoMapDownloadName,
} from "../../../src/viewer/views/iso-map-url.js";

function paramsOf(url: string): URLSearchParams {
  const qIdx = url.indexOf("?");
  return new URLSearchParams(qIdx === -1 ? "" : url.slice(qIdx + 1));
}

describe("buildIsoMapUrl", () => {
  it("targets the /api/iso-map route", () => {
    expect(buildIsoMapUrl(ISO_MAP_DEFAULTS).startsWith(`${ISO_MAP_ENDPOINT}?`)).toBe(true);
  });

  it("emits every parameter explicitly, even at the defaults", () => {
    const params = paramsOf(buildIsoMapUrl(ISO_MAP_DEFAULTS));
    expect(params.get("source")).toBe("auto");
    expect(params.get("maxNodes")).toBe("40");
    expect(params.get("externals")).toBe("1");
  });

  it("encodes externals as 0 when disabled", () => {
    const url = buildIsoMapUrl({ source: "scan", maxNodes: 12, includeExternals: false });
    const params = paramsOf(url);
    expect(params.get("source")).toBe("scan");
    expect(params.get("maxNodes")).toBe("12");
    expect(params.get("externals")).toBe("0");
  });

  it("clamps out-of-range node counts before they reach the query string", () => {
    expect(paramsOf(buildIsoMapUrl({ ...ISO_MAP_DEFAULTS, maxNodes: 9999 })).get("maxNodes"))
      .toBe(String(ISO_MAP_MAX_NODES));
    expect(paramsOf(buildIsoMapUrl({ ...ISO_MAP_DEFAULTS, maxNodes: -5 })).get("maxNodes"))
      .toBe(String(ISO_MAP_MIN_NODES));
  });
});

describe("clampMaxNodes", () => {
  it("falls back to the default for non-finite input", () => {
    expect(clampMaxNodes(Number.NaN)).toBe(ISO_MAP_DEFAULTS.maxNodes);
    expect(clampMaxNodes(Number.POSITIVE_INFINITY)).toBe(ISO_MAP_DEFAULTS.maxNodes);
  });

  it("rounds fractional input to an integer the route accepts", () => {
    expect(clampMaxNodes(12.4)).toBe(12);
    expect(clampMaxNodes(12.6)).toBe(13);
  });

  it("keeps in-range values untouched", () => {
    expect(clampMaxNodes(1)).toBe(1);
    expect(clampMaxNodes(500)).toBe(500);
  });
});

describe("isIsoMapSource", () => {
  it("accepts the three route modes and rejects anything else", () => {
    expect(isIsoMapSource("auto")).toBe(true);
    expect(isIsoMapSource("sourcevision")).toBe(true);
    expect(isIsoMapSource("scan")).toBe(true);
    expect(isIsoMapSource("SCAN")).toBe(false);
    expect(isIsoMapSource("")).toBe(false);
  });
});

describe("isoMapDownloadName", () => {
  it("encodes the applied options so downloads stay distinguishable", () => {
    expect(isoMapDownloadName({ source: "scan", maxNodes: 25, includeExternals: true }))
      .toBe("iso-map-scan-25.html");
  });

  it("uses the clamped node count", () => {
    expect(isoMapDownloadName({ source: "auto", maxNodes: 10_000, includeExternals: true }))
      .toBe(`iso-map-auto-${ISO_MAP_MAX_NODES}.html`);
  });
});
