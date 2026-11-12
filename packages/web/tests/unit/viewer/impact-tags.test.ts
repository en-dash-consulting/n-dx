// @vitest-environment jsdom
/**
 * Impact tags and the plain-language title: chip text, the detail panel's
 * Impact section, and a row falling back to the title with no summary.
 *
 * @see src/viewer/components/impact-tags.ts
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  ImpactDetail,
  ImpactTags,
  displayTitle,
  kindsText,
  resetImpactCacheForTests,
  sizeText,
  useItemImpacts,
  type ItemImpact,
} from "../../../src/viewer/components/impact-tags.js";

/** The shared live feed: each socket the module opens, so a test can send it frames. */
const sockets = vi.hoisted(() => [] as { onmessage: ((e: { data: string }) => void) | null; close: () => void; closed: boolean }[]);
vi.mock("../../../src/viewer/session.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/viewer/session.js")>(),
  openWebSocket: vi.fn(() => {
    const socket = { onmessage: null, closed: false, close() { socket.closed = true; } };
    sockets.push(socket);
    return socket;
  }),
}));

const IMPACT: ItemImpact = {
  basis: "actual",
  files: ["package.json", "src/a.ts", "src/b.ts", "tests/a.test.ts", "src/secrets.ts"],
  fileCount: 14,
  size: "large",
  kinds: { code: 9, test: 3, docs: 1, config: 1 },
  security: ["src/secrets.ts"],
  essential: ["package.json"],
};

let root: HTMLDivElement | undefined;
afterEach(() => { if (root) { render(null, root); root.remove(); root = undefined; } });

function mount(vnode: ReturnType<typeof h>): HTMLDivElement {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(vnode, root!); });
  return root;
}

describe("displayTitle", () => {
  it("uses the summary when there is one, else the title", () => {
    expect(displayTitle({ title: "Refactor x.ts", summary: "  Faster checkout  " })).toBe("Faster checkout");
    expect(displayTitle({ title: "Refactor x.ts", summary: "  " })).toBe("Refactor x.ts");
    expect(displayTitle({ title: "Refactor x.ts" })).toBe("Refactor x.ts");
  });
});

describe("chip text", () => {
  it("says measured sizes plainly and estimates with a tilde", () => {
    expect(sizeText(IMPACT)).toBe("Large · 14 files");
    expect(sizeText({ ...IMPACT, basis: "expected", fileCount: 1, size: "small" })).toBe("Small · ~1 file");
    expect(sizeText({ ...IMPACT, size: null, fileCount: 0 })).toBeNull();
  });

  it("lists file kinds largest first in plain words", () => {
    expect(kindsText(IMPACT.kinds)).toBe("9 code files · 3 tests · 1 config file · 1 doc");
  });
});

describe("ImpactTags", () => {
  it("orders security, essential, size, and kinds only when full", () => {
    const text = (full: boolean) => {
      const el = mount(h(ImpactTags, { impact: IMPACT, full }));
      const out = [...el.querySelectorAll(".impact-tag")].map((t) => t.textContent);
      render(null, el); el.remove(); root = undefined;
      return out;
    };
    expect(text(false)).toEqual(["Security", "Essential", "Large · 14 files"]);
    expect(text(true)).toEqual(["Security", "Essential", "Large · 14 files", "9 code files · 3 tests · 1 config file · 1 doc"]);
  });

  it("renders nothing without an impact", () => {
    expect(mount(h(ImpactTags, { impact: undefined })).innerHTML).toBe("");
  });
});

describe("ImpactDetail", () => {
  it("names its source, the flagged files and folds the full list with a count of the rest", () => {
    const el = mount(h(ImpactDetail, { impact: IMPACT }));
    expect(el.querySelector(".impact-source")?.textContent).toBe("From the files runs on this item changed.");
    const labels = [...el.querySelectorAll(".impact-list-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Touches secrets, keys or credentials", "Files much of the project depends on"]);
    expect(el.querySelector(".impact-all-files summary")?.textContent).toBe("All 14 files");
    expect(el.querySelectorAll(".impact-all-files li")).toHaveLength(5);
    expect(el.textContent).toContain("…and 9 more");
  });
});

describe("useItemImpacts on a page left open", () => {
  const EXPECTED: ItemImpact = { ...IMPACT, basis: "expected", files: ["src/a.ts"], fileCount: 1, size: "small", kinds: { code: 1 }, security: [], essential: [] };
  const ACTUAL: ItemImpact = { ...IMPACT, fileCount: 12 };

  function Consumer({ id }: { id: string }) {
    const impact = useItemImpacts().t1;
    return h("span", { id }, impact ? `${impact.basis}:${impact.fileCount}` : "none");
  }

  const text = (id: string) => document.getElementById(id)?.textContent;
  const send = (frame: Record<string, unknown>) => {
    for (const socket of sockets.filter((s) => !s.closed)) socket.onmessage?.({ data: JSON.stringify(frame) });
  };

  afterEach(() => {
    resetImpactCacheForTests();
    sockets.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves a mounted row from expected to actual impact when a run lands, with one socket and one fetch per burst", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let served: ItemImpact = EXPECTED;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: { t1: served } }) }));
    vi.stubGlobal("fetch", fetchMock);

    mount(h("div", null, h(Consumer, { id: "a" }), h(Consumer, { id: "b" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text("a")).toBe("expected:1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);

    // A run finishes; well past the 30-second TTL, with nothing remounting.
    served = ACTUAL;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    send({ type: "hench:run-changed" });
    send({ type: "hench:run-changed" });
    send({ type: "rex:prd-changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

    expect(text("a")).toBe("actual:12");
    expect(text("b")).toBe("actual:12");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores frames that do not move impact, and closes the socket once no row is mounted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: { t1: EXPECTED } }) }));
    vi.stubGlobal("fetch", fetchMock);

    mount(h(Consumer, { id: "a" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    send({ type: "sv:analysis-changed" });
    send({ type: "rex:prd-changed", workspace: "another-worktree" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => { render(null, root!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(sockets[0]!.closed).toBe(true);
  });

  it("keeps the impacts already shown when a refetch fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let fail = false;
    const fetchMock = vi.fn(async () => (fail
      ? { ok: false, status: 500, json: async () => ({ error: "boom" }) }
      : { ok: true, json: async () => ({ items: { t1: EXPECTED } }) }));
    vi.stubGlobal("fetch", fetchMock);

    mount(h(Consumer, { id: "a" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text("a")).toBe("expected:1");

    fail = true;
    send({ type: "rex:prd-changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text("a")).toBe("expected:1");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    send({ type: "sv:data-changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text("a")).toBe("expected:1");
  });

  it("loads again when a change lands while a load is still in flight", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let served: ItemImpact = EXPECTED;
    const fetchMock = vi.fn(async () => {
      const body = { items: { t1: served } };
      if (fetchMock.mock.calls.length === 2) await gate;
      return { ok: true, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchMock);

    mount(h(Consumer, { id: "a" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    send({ type: "rex:prd-changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The second load read the old impact; a run lands before it answers.
    served = ACTUAL;
    send({ type: "hench:run-changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    release();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text("a")).toBe("actual:12");
  });
});
