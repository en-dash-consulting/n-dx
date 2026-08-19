// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ActivityView } from "../../../src/viewer/views/activity.js";
import { AuthStatusChip } from "../../../src/viewer/views/llm-provider.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

const LOG = {
  entries: [
    { timestamp: "2026-08-14T10:00:00Z", event: "status_changed", itemId: "abcdef123456", detail: "pending → in_progress" },
    { timestamp: "2026-08-14T11:00:00Z", event: "work_log", itemId: "abcdef123456", detail: "Implemented the thing" },
    { timestamp: "2026-08-14T12:00:00Z", event: "item_added", itemId: "999888777666", detail: "Added: New task" },
  ],
};

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  const mock = vi.fn(async (url: string) => {
    const { status, body } = handler(String(url));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
  await act(async () => {});
}

describe("ActivityView (execution-log viewer)", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("renders log entries newest first", async () => {
    stubFetch(() => ({ status: 200, body: LOG }));
    act(() => { render(h(ActivityView, null), root); });
    await settle();

    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("item_added");
    expect(rows[2].textContent).toContain("status_changed");
    // Item ids are abbreviated for scanning.
    expect(rows[0].textContent).toContain("99988877");
  });

  it("filters by event", async () => {
    stubFetch(() => ({ status: 200, body: LOG }));
    act(() => { render(h(ActivityView, null), root); });
    await settle();

    const select = root.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "work_log";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Implemented the thing");
  });

  it("searches detail text", async () => {
    stubFetch(() => ({ status: 200, body: LOG }));
    act(() => { render(h(ActivityView, null), root); });
    await settle();

    const input = root.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      input.value = "in_progress";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Array.from(root.querySelectorAll("tbody tr"))).toHaveLength(1);
  });

  it("shows an empty state when nothing is logged", async () => {
    stubFetch(() => ({ status: 200, body: { entries: [] } }));
    act(() => { render(h(ActivityView, null), root); });
    await settle();
    expect(root.textContent).toContain("No activity recorded yet");
  });

  it("surfaces a load failure", async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    act(() => { render(h(ActivityView, null), root); });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
  });
});

describe("AuthStatusChip", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    clearProjectMetadataCache();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("reports usable credentials", async () => {
    stubFetch((url) => url.includes("/api/commands/auth")
      ? { status: 200, body: { ok: true, output: "claude: credentials OK", error: null } }
      : { status: 200, body: {} });
    act(() => { render(h(AuthStatusChip, null), root); });
    await settle();
    expect(root.textContent).toContain("Credentials OK");
    expect(root.querySelector(".auth-chip-ok")).toBeTruthy();
  });

  it("reports unusable credentials with the reason", async () => {
    stubFetch((url) => url.includes("/api/commands/auth")
      ? { status: 200, body: { ok: false, output: "", error: "No API key found for vendor claude" } }
      : { status: 200, body: {} });
    act(() => { render(h(AuthStatusChip, null), root); });
    await settle();
    expect(root.textContent).toContain("Credentials not usable");
    expect(root.textContent).toContain("No API key found");
  });

  it("re-checks on demand", async () => {
    const mock = stubFetch((url) => url.includes("/api/commands/auth")
      ? { status: 200, body: { ok: true, output: "ok", error: null } }
      : { status: 200, body: {} });
    act(() => { render(h(AuthStatusChip, null), root); });
    await settle();
    const before = mock.mock.calls.length;

    await act(async () => {
      (root.querySelector("button") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mock.mock.calls.length).toBeGreaterThan(before);
  });
});
