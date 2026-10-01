// @vitest-environment jsdom
/**
 * The live feed is shared: however many components read it, there is one
 * fetch, one socket and one poller, and they outlive any one reader.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { liveRunningCount, useLive, type LiveSummary } from "../../../src/viewer/hooks/use-live.js";
import { getRegisteredPollers, resetPollingManager } from "../../../src/viewer/polling/index.js";

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor() { FakeSocket.instances.push(this); }
  close() { this.closed = true; }
}

const open = () => FakeSocket.instances.filter((s) => !s.closed);
const livePollers = () => getRegisteredPollers().filter((p) => p.key === "live");

function summary(running: number): LiveSummary {
  return { runs: [], jobs: [], counts: { running, stale: 0, jobs: 0 } };
}

function Probe() {
  return h("span", null, String(liveRunningCount(useLive())));
}

describe("the shared live feed", () => {
  let roots: HTMLDivElement[];
  let body: LiveSummary;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetPollingManager();
    FakeSocket.instances = [];
    body = summary(1);
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", fetchMock);
    roots = [document.createElement("div"), document.createElement("div")];
    for (const r of roots) document.body.appendChild(r);
  });

  afterEach(() => {
    for (const r of roots) { render(null, r); r.remove(); }
    resetPollingManager();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 0) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  async function mountBoth() {
    act(() => { render(h(Probe, null), roots[0]); });
    act(() => { render(h(Probe, null), roots[1]); });
    await settle();
  }

  it("opens one socket, one poller and one fetch for two readers", async () => {
    await mountBoth();
    expect(open()).toHaveLength(1);
    expect(livePollers()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(roots.map((r) => r.textContent)).toEqual(["1", "1"]);
  });

  it("keeps polling for the reader left when the other unmounts", async () => {
    await mountBoth();
    act(() => { render(null, roots[0]); });
    expect(livePollers()).toEqual([expect.objectContaining({ active: true })]);
    expect(open()).toHaveLength(1);

    body = summary(4);
    await settle(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(roots[1].textContent).toBe("4");
  });

  it("closes the socket and the poll when the last reader leaves, and does not reconnect", async () => {
    await mountBoth();
    act(() => { render(null, roots[0]); render(null, roots[1]); });
    expect(open()).toHaveLength(0);
    expect(livePollers()).toHaveLength(0);
    await settle(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects with backoff after the socket closes, and catches up on reopening", async () => {
    await mountBoth();
    const first = FakeSocket.instances[0];
    act(() => { first.onopen?.(); });

    body = summary(3);
    act(() => { first.closed = true; first.onclose?.(); });
    await settle(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await settle(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // A failed attempt waits twice as long before the next.
    const second = FakeSocket.instances[1];
    act(() => { second.closed = true; second.onclose?.(); });
    await settle(1_999);
    expect(FakeSocket.instances).toHaveLength(2);
    await settle(1);
    expect(FakeSocket.instances).toHaveLength(3);

    act(() => { FakeSocket.instances[2].onopen?.(); });
    await settle();
    expect(roots.map((r) => r.textContent)).toEqual(["3", "3"]);
    expect(open()).toHaveLength(1);
  });
});
