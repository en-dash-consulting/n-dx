// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { CopyLinkButton, buildShareableUrl } from "../../../src/viewer/components/copy-link-button.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

// ── buildShareableUrl ───────────────────────────────────────────────

describe("buildShareableUrl", () => {
  // jsdom origin includes port: http://localhost:3000
  const origin = window.location.origin;

  it("builds full URL from path with current origin", () => {
    const url = buildShareableUrl("/prd/abc123");
    expect(url).toBe(`${origin}/prd/abc123`);
  });

  it("normalizes path without leading slash", () => {
    const url = buildShareableUrl("hench-runs/xyz");
    expect(url).toBe(`${origin}/hench-runs/xyz`);
  });

  it("preserves path with leading slash", () => {
    const url = buildShareableUrl("/hench-runs/run-42");
    expect(url).toBe(`${origin}/hench-runs/run-42`);
  });

  it("handles root path", () => {
    const url = buildShareableUrl("/");
    expect(url).toBe(`${origin}/`);
  });

  it("includes origin in URL", () => {
    const url = buildShareableUrl("/prd/test");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("/prd/test");
  });
});

// ── CopyLinkButton rendering ────────────────────────────────────────

describe("CopyLinkButton", () => {
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with default label", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    const label = btn.querySelector(".copy-link-label");
    expect(label?.textContent).toBe("Copy Link");
  });

  it("renders with custom label", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1", label: "Share" }));
    const label = root.querySelector(".copy-link-label");
    expect(label?.textContent).toBe("Share");
  });

  it("applies compact class when compact prop is true", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1", compact: true }));
    const btn = root.querySelector(".copy-link-btn");
    expect(btn?.classList.contains("copy-link-btn-compact")).toBe(true);
  });

  it("applies additional CSS class", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1", class: "my-extra" }));
    const btn = root.querySelector(".copy-link-btn");
    expect(btn?.classList.contains("my-extra")).toBe(true);
  });

  it("renders link icon initially", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1" }));
    const icon = root.querySelector(".copy-link-icon");
    expect(icon?.textContent).toBe("\ud83d\udd17");
  });

  it("copies correct URL to clipboard on click", async () => {
    const origin = window.location.origin;
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-abc" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;

    btn.click();

    // Flush microtask queue for the clipboard promise
    await new Promise((r) => setTimeout(r, 0));

    expect(clipboardWriteText).toHaveBeenCalledWith(`${origin}/prd/task-abc`);
  });

  it("copies hench run URL correctly", async () => {
    const origin = window.location.origin;
    const root = renderToDiv(h(CopyLinkButton, { path: "/hench-runs/run-xyz" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(clipboardWriteText).toHaveBeenCalledWith(`${origin}/hench-runs/run-xyz`);
  });

  it("shows copied state after successful copy", async () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // Re-query after state update
    const updatedBtn = root.querySelector(".copy-link-btn");
    expect(updatedBtn?.classList.contains("copy-link-btn-copied")).toBe(true);

    const label = root.querySelector(".copy-link-label");
    expect(label?.textContent).toBe("Copied!");

    const icon = root.querySelector(".copy-link-icon");
    expect(icon?.textContent).toBe("\u2713");
  });

  it("has correct aria-label", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Copy Link");
  });

  it("has button type attribute", () => {
    const root = renderToDiv(h(CopyLinkButton, { path: "/prd/task-1" }));
    const btn = root.querySelector(".copy-link-btn") as HTMLButtonElement;
    expect(btn.getAttribute("type")).toBe("button");
  });
});
