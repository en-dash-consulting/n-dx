import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_FILES } from "../../../src/viewer/external.js";

const manifestFixture = {
  schemaVersion: "1.0.0",
  toolVersion: "0.1.0",
  analyzedAt: "2026-04-20T00:00:00.000Z",
  targetPath: "/repo",
  modules: {
    inventory: {
      status: "complete",
      startedAt: "2026-04-20T00:00:00.000Z",
      completedAt: "2026-04-20T00:01:00.000Z",
    },
  },
};

async function importLoader() {
  vi.resetModules();
  return import("../../../src/viewer/loader/index.js");
}

describe("viewer loader", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads uncached modules and notifies listeners with validated data", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => manifestFixture,
    } as Response);

    const { loadModules, onDataChange, getData } = await importLoader();
    const handler = vi.fn();
    onDataChange(handler);

    const result = await loadModules(["manifest"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/data/${DATA_FILES.manifest}`);
    expect(result.manifest).toEqual(manifestFixture);
    expect(getData().manifest).toEqual(manifestFixture);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(result);
  });

  it("skips fetches for modules that are already loaded", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => manifestFixture,
    } as Response);

    const { loadModules, onDataChange } = await importLoader();
    const handler = vi.fn();
    onDataChange(handler);

    await loadModules(["manifest"]);
    handler.mockClear();
    fetchMock.mockClear();

    const result = await loadModules(["manifest"]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.manifest).toEqual(manifestFixture);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves invalid modules unloaded and still notifies once for the attempted batch", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: "1.0.0" }),
    } as Response);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadModules, onDataChange, getData } = await importLoader();
    const handler = vi.fn();
    onDataChange(handler);

    const result = await loadModules(["manifest"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.manifest).toBeNull();
    expect(getData().manifest).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(result);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("Validation failed");
  });
});
