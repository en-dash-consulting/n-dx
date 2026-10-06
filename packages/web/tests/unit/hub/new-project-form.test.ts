// @vitest-environment jsdom
/**
 * The hub page's new-project script, executed.
 *
 * The markup tests next door assert what is rendered; this one runs the inline
 * script against it, which is the only way to catch a form that renders
 * perfectly and does nothing — the first version looked up an id the markup
 * never had, so the button opened no panel and no path was ever previewed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHomePage } from "../../../src/hub/home.js";

const PARENT = "/code/projects";

interface PreviewAnswer {
  defaultParent: string;
  parent: string;
  name: string;
  path: string;
  ok: boolean;
  problem: string | null;
  note: string | null;
}

function previewAnswer(overrides: Partial<PreviewAnswer> = {}): PreviewAnswer {
  return {
    defaultParent: PARENT,
    parent: PARENT,
    name: "my-app",
    path: `${PARENT}/my-app`,
    ok: true,
    problem: null,
    note: null,
    ...overrides,
  };
}

/** Render the page into this jsdom document and run its new-project script. */
function mountPage(): void {
  const html = renderHomePage({ projects: [], generatedAt: "t" }, PARENT);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  const script = [...parsed.querySelectorAll("script")]
    .map((s) => s.textContent ?? "")
    .find((text) => text.includes("new-panel"))!;
  // Window scope, so the script's `fetch`/`setTimeout` are the stubbed ones.
  window.eval(script);
}

const flush = (ms = 300) => new Promise((r) => setTimeout(r, ms));

describe("the new-project form, running", () => {
  let previews: PreviewAnswer[];
  let posted: Record<string, unknown>[];
  let createResponse: { status: number; body: Record<string, unknown> };

  beforeEach(() => {
    previews = [previewAnswer()];
    posted = [];
    createResponse = { status: 201, body: { url: "/p/my-app/", path: `${PARENT}/my-app` } };

    vi.stubGlobal("fetch", vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (url.startsWith("/api/hub/new-project")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const answer = previews[Math.min(previews.length - 1, 0)];
        return {
          ok: true,
          json: async () => ({ ...answer, name: params.get("name") ?? "" }),
        } as unknown as Response;
      }
      if (url === "/api/hub/projects/new" && opts?.method === "POST") {
        posted.push(JSON.parse(opts.body ?? "{}") as Record<string, unknown>);
        return {
          status: createResponse.status,
          json: async () => createResponse.body,
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }));
  });

  it("opens the panel on the button, and says so for assistive tech", async () => {
    mountPage();
    const panel = document.getElementById("new-panel") as HTMLFormElement;
    const toggle = document.getElementById("new-toggle")!;
    expect(panel.hidden).toBe(true);

    toggle.click();
    await flush();

    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("previews the path the server resolved, not one joined in the browser", async () => {
    previews = [previewAnswer({ path: "/code/projects/my-app" })];
    mountPage();
    document.getElementById("new-toggle")!.click();

    const nameInput = document.getElementById("new-name") as HTMLInputElement;
    nameInput.value = "my-app";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const preview = document.getElementById("new-preview")!;
    expect(preview.textContent).toContain("Will create:");
    expect(preview.querySelector("strong")?.textContent).toBe("/code/projects/my-app");
    expect((document.getElementById("new-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the problem and refuses to submit a path the server would reject", async () => {
    previews = [previewAnswer({ ok: false, problem: "That folder already exists and is not empty." })];
    mountPage();
    document.getElementById("new-toggle")!.click();

    const nameInput = document.getElementById("new-name") as HTMLInputElement;
    nameInput.value = "taken";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(document.getElementById("new-preview")!.textContent).toContain("already exists and is not empty");
    expect((document.getElementById("new-submit") as HTMLButtonElement).disabled).toBe(true);

    document.getElementById("new-panel")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(posted).toHaveLength(0);
  });

  it("notes an existing empty folder without blocking it", async () => {
    previews = [previewAnswer({ note: "That folder already exists and is empty — it will be used as it is." })];
    mountPage();
    document.getElementById("new-toggle")!.click();
    const nameInput = document.getElementById("new-name") as HTMLInputElement;
    nameInput.value = "empty";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(document.getElementById("new-preview")!.textContent).toContain("already exists and is empty");
    expect((document.getElementById("new-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("goes busy while the folder is created, then opens the new project", async () => {
    mountPage();
    document.getElementById("new-toggle")!.click();
    const nameInput = document.getElementById("new-name") as HTMLInputElement;
    nameInput.value = "my-app";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    document.getElementById("new-panel")!.dispatchEvent(new Event("submit", { cancelable: true }));
    // Synchronously busy — the operator never sees an idle-looking button
    // while a folder is being created and a server started.
    expect(document.getElementById("new-status")!.hidden).toBe(false);
    expect(document.getElementById("new-spinner")!.hidden).toBe(false);
    expect((document.getElementById("new-submit") as HTMLButtonElement).disabled).toBe(true);

    await flush();
    expect(posted).toEqual([{ parent: PARENT, name: "my-app" }]);
    // The status names the path it made before the page goes anywhere.
    expect(document.getElementById("new-status")!.textContent).toContain(`${PARENT}/my-app`);
  });

  it("surfaces a refusal from the server and lets the operator try again", async () => {
    createResponse = { status: 409, body: { error: 'That folder is already registered as "my-app".' } };
    mountPage();
    document.getElementById("new-toggle")!.click();
    const nameInput = document.getElementById("new-name") as HTMLInputElement;
    nameInput.value = "my-app";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    document.getElementById("new-panel")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    const status = document.getElementById("new-status")!;
    expect(status.textContent).toContain("already registered");
    expect(status.className).toContain("new-status-error");
    expect(document.getElementById("new-spinner")!.hidden).toBe(true);
    expect((document.getElementById("new-submit") as HTMLButtonElement).disabled).toBe(false);
  });
});
