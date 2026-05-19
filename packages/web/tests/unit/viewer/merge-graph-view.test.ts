// @vitest-environment jsdom
/**
 * Tests for the MergeGraphView component.
 *
 * Covers:
 *   - default full-tree rendering (every PRD item visible without expansion)
 *   - the "Epics only" view-mode toggle in the header
 *   - selection-driven highlighting (root + transitive descendants)
 *   - viewport recenter when a node is clicked
 *   - lazy origin fetch on PRD click and the resulting detail-panel section
 *   - the inline PRD front-matter summary card
 *   - the merge metadata panel above the graph
 *
 * Mocks all backing fetches (`/api/merge-graph`, `/data/prd.json`,
 * `/api/prd-origin`) so the view renders end-to-end without a real server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  MergeGraphView,
  collectPrdSubtreeIds,
  resolveMergeMetaForSelection,
} from "../../../src/viewer/views/merge-graph.js";

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface MinimalPrdNode {
  kind: "prd";
  id: string;
  title: string;
  level: string;
  status: string;
  parentId?: string;
  priority?: string;
  shape?: string;
  treePath?: string;
}

interface MinimalMergeNode {
  kind: "merge";
  id: string;
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  mergedAt: string;
  author: string;
  parents: string[];
  filesSummary: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
    copied: number;
    other: number;
    total: number;
  };
  files: Array<{ status: string; path: string }>;
}

interface MinimalGraph {
  generatedAt: string;
  nodes: Array<MinimalPrdNode | MinimalMergeNode>;
  edges: Array<{ from: string; to: string; attribution: string }>;
  stats: {
    merges: number;
    mergesWithPrdLinkage: number;
    mergesWithoutPrdLinkage: number;
    prdItemsLinked: number;
  };
}

function emptyFilesSummary() {
  return {
    added: 0, modified: 0, deleted: 0, renamed: 0, copied: 0, other: 0, total: 0,
  };
}

/**
 * Build a 4-node PRD subtree with one branching feature so descendant logic
 * can be exercised: epic E1 → feature F1 → task T1 + task T2; epic E2 is
 * unrelated. Each PRD node carries a `treePath` so origin lookups have a
 * realistic key.
 */
function makeGraph(): MinimalGraph {
  // Shape values mirror what `flattenPrdItems` would produce on disk:
  //   E1 has F1 (a folder child) only      → trapezoid
  //   F1 has T1+T2 (leaf children)         → diamond
  //   T1, T2, E2 are leaves (no children)  → triangle
  return {
    generatedAt: "2026-05-08T00:00:00Z",
    nodes: [
      { kind: "prd", id: "E1", title: "Epic One", level: "epic", status: "in_progress", treePath: "epic-one", shape: "trapezoid" },
      { kind: "prd", id: "F1", title: "Feature One", level: "feature", status: "pending", parentId: "E1", treePath: "epic-one/feature-one", shape: "diamond" },
      { kind: "prd", id: "T1", title: "Task One", level: "task", status: "pending", parentId: "F1", priority: "high", treePath: "epic-one/feature-one/task-one", shape: "triangle" },
      { kind: "prd", id: "T2", title: "Task Two", level: "task", status: "pending", parentId: "F1", treePath: "epic-one/feature-one/task-two", shape: "triangle" },
      { kind: "prd", id: "E2", title: "Epic Two", level: "epic", status: "pending", treePath: "epic-two", shape: "triangle" },
      {
        kind: "merge", id: "M1", sha: "abcdef1", shortSha: "abcdef1",
        subject: "fix: thing", body: "", mergedAt: "2026-05-01T00:00:00Z",
        author: "alice", parents: [],
        filesSummary: emptyFilesSummary(), files: [],
      },
    ],
    edges: [
      { from: "M1", to: "T1", attribution: "commit-message" },
    ],
    stats: { merges: 1, mergesWithPrdLinkage: 1, mergesWithoutPrdLinkage: 0, prdItemsLinked: 1 },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  fn();
}

/**
 * Helper: find a PRD node by aria-label substring, scoped to currently
 * rendered nodes. Returns undefined if not currently visible.
 */
function findPrdNode(root: HTMLElement, titleSubstring: string): SVGGElement | undefined {
  return [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
    .find((n) => n.getAttribute("aria-label")?.includes(titleSubstring));
}

/**
 * Click a PRD node by title. Throws if it isn't currently visible — that
 * surfaces ordering bugs in selection-driven tests instead of letting a
 * missing click silently no-op.
 */
async function clickPrd(root: HTMLElement, titleSubstring: string) {
  const node = findPrdNode(root, titleSubstring);
  if (!node) throw new Error(`PRD node with title containing "${titleSubstring}" is not currently visible`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });
}

/**
 * Click the chip that switches between "Full tree" and "Epics only" modes.
 */
async function clickToggle(root: HTMLElement, label: "Full tree" | "Epics only") {
  const button = [...root.querySelectorAll<HTMLButtonElement>(".mg-view-toggle .mg-chip")]
    .find((b) => b.textContent === label);
  if (!button) throw new Error(`view-mode chip "${label}" not found`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });
}

// ── collectPrdSubtreeIds ──────────────────────────────────────────────────────

describe("collectPrdSubtreeIds", () => {
  it("returns the root and every transitive descendant", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "E1");
    expect([...subtree].sort()).toEqual(["E1", "F1", "T1", "T2"]);
  });

  it("returns just the root for a leaf node", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "T1");
    expect([...subtree]).toEqual(["T1"]);
  });

  it("excludes unrelated PRD branches", () => {
    const subtree = collectPrdSubtreeIds(makeGraph() as never, "E2");
    expect([...subtree]).toEqual(["E2"]);
  });
});

// ── resolveMergeMetaForSelection ─────────────────────────────────────────────

describe("resolveMergeMetaForSelection", () => {
  it("returns [] for null graph or null selection", () => {
    expect(resolveMergeMetaForSelection(null, null)).toEqual([]);
    expect(
      resolveMergeMetaForSelection(makeGraph() as never, null),
    ).toEqual([]);
  });

  it("returns the merge node directly when a merge is selected", () => {
    const graph = makeGraph();
    const merge = graph.nodes.find((n) => n.kind === "merge")!;
    const result = resolveMergeMetaForSelection(
      graph as never,
      { kind: "merge", node: merge as never } as never,
    );
    expect(result.map((m) => m.id)).toEqual(["M1"]);
  });

  it("returns [] for a PRD selection with no linked merges", () => {
    const result = resolveMergeMetaForSelection(
      makeGraph() as never,
      {
        kind: "prd",
        node: { id: "T2", title: "Task Two", level: "task", status: "pending" },
        linkedMergeIds: [],
      } as never,
    );
    expect(result).toEqual([]);
  });

  it("resolves linked merges for a PRD selection, sorted by mergedAt desc", () => {
    const graph: MinimalGraph = { ...makeGraph() };
    graph.nodes = [
      ...graph.nodes,
      {
        kind: "merge", id: "M2", sha: "deadbee", shortSha: "deadbee",
        subject: "later", body: "", mergedAt: "2026-05-03T00:00:00Z",
        author: "bob", parents: [],
        filesSummary: emptyFilesSummary(), files: [],
      },
    ];
    const result = resolveMergeMetaForSelection(
      graph as never,
      {
        kind: "prd",
        node: { id: "T1", title: "Task One", level: "task", status: "pending" },
        linkedMergeIds: ["M1", "M2"],
      } as never,
    );
    expect(result.map((m) => m.id)).toEqual(["M2", "M1"]);
  });
});

// ── MergeGraphView (DOM) ─────────────────────────────────────────────────────

describe("MergeGraphView", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
    vi.restoreAllMocks();
  });

  /**
   * Default mount: returns the standard 4-node PRD fixture, the matching
   * `/data/prd.json` items, and an empty `/api/prd-origin` response (no
   * commit history) for any path. Tests that need a different origin can
   * set `originHandler`.
   */
  function mountWithPrd(
    items: Array<Record<string, unknown>>,
    options: {
      originHandler?: (url: string) => Promise<Response>;
    } = {},
  ) {
    fetchSpy.mockImplementation((url: string) => {
      if (url.startsWith("/api/merge-graph")) {
        return Promise.resolve(new Response(JSON.stringify(makeGraph()), { status: 200 }));
      }
      if (url.startsWith("/data/prd.json")) {
        return Promise.resolve(new Response(JSON.stringify({ items }), { status: 200 }));
      }
      if (url.startsWith("/api/prd-origin")) {
        if (options.originHandler) return options.originHandler(url);
        return Promise.resolve(new Response(JSON.stringify({ origin: null }), { status: 200 }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    act(() => {
      render(h(MergeGraphView, {}), root);
    });
  }

  // ── Default full-tree rendering ────────────────────────────────────────────

  it("renders every PRD item from the graph on initial load (full-tree default)", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    // Five PRD nodes — every level (epic, feature, task) is visible without
    // any expansion gesture.
    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const labels = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .map((n) => n.getAttribute("aria-label") ?? "");
    expect(labels.some((l) => l.includes("Epic One"))).toBe(true);
    expect(labels.some((l) => l.includes("Feature One"))).toBe(true);
    expect(labels.some((l) => l.includes("Task One"))).toBe(true);
    expect(labels.some((l) => l.includes("Task Two"))).toBe(true);
    expect(labels.some((l) => l.includes("Epic Two"))).toBe(true);
  });

  it("renders no chevron affordance — clicking a node only selects, never toggles", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    expect(root.querySelector(".mg-affordance")).toBeNull();
    expect(root.querySelector(".mg-prd-node[aria-expanded]")).toBeNull();

    // Clicking E1 doesn't hide F1 (which would happen under the old
    // expand/collapse behavior — F1 was a direct child of E1).
    await clickPrd(root, "Epic One");
    expect(findPrdNode(root, "Feature One")).toBeTruthy();

    // Clicking E1 again doesn't make F1 appear/disappear either.
    await clickPrd(root, "Epic One");
    expect(findPrdNode(root, "Feature One")).toBeTruthy();
    expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
  });

  // ── View-mode toggle ───────────────────────────────────────────────────────

  it("renders both view-mode chips with full-tree active by default", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelector(".mg-view-toggle")).not.toBeNull();
    });

    const chips = [...root.querySelectorAll<HTMLButtonElement>(".mg-view-toggle .mg-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["Full tree", "Epics only"]);
    expect(chips[0].classList.contains("active")).toBe(true);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips[1].classList.contains("active")).toBe(false);
    expect(chips[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("trims to epics only when 'Epics only' is selected and restores everything when toggled back", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickToggle(root, "Epics only");
    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(2);
    });
    const epicLabels = [...root.querySelectorAll<SVGGElement>(".mg-prd-node")]
      .map((n) => n.getAttribute("aria-label") ?? "");
    expect(epicLabels.every((l) => l.includes("epic"))).toBe(true);

    await clickToggle(root, "Full tree");
    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });
  });

  // ── Selection / highlight behavior ─────────────────────────────────────────

  it("highlights the clicked PRD subtree and dims unrelated nodes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress", priority: "high", tags: ["alpha", "beta"] },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Epic One");

    const opacityFor = (title: string) =>
      (findPrdNode(root, title) as unknown as HTMLElement | undefined)?.style.opacity || "";
    expect(opacityFor("Epic One")).toBe("1");
    expect(opacityFor("Feature One")).toBe("1");
    expect(opacityFor("Task One")).toBe("1");
    expect(opacityFor("Task Two")).toBe("1");
    expect(opacityFor("Epic Two")).toBe("0.2");
  });

  it("clears the previous highlight when a different node is selected", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Epic One");
    const find = (title: string) =>
      findPrdNode(root, title) as unknown as HTMLElement;
    expect(find("Epic One").style.opacity || "1").toBe("1");
    expect(find("Epic Two").style.opacity).toBe("0.2");

    await clickPrd(root, "Epic Two");
    expect(find("Epic Two").style.opacity || "1").toBe("1");
    expect(find("Epic One").style.opacity).toBe("0.2");
    expect(find("Feature One").style.opacity).toBe("0.2");
  });

  // ── Recenter on click ─────────────────────────────────────────────────────

  it("recenters the SVG viewport on the clicked node", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const parseViewBox = (): { x: number; y: number; w: number; h: number } => {
      const vb = root.querySelector("svg.mg-svg")!.getAttribute("viewBox") ?? "";
      const [x, y, w, h] = vb.split(/\s+/).map((s) => parseFloat(s));
      return { x, y, w, h };
    };
    const parseTranslate = (el: SVGGElement): { x: number; y: number } => {
      const t = el.getAttribute("transform") ?? "";
      const m = /translate\(([^,]+),([^)]+)\)/.exec(t);
      return { x: m ? parseFloat(m[1]) : NaN, y: m ? parseFloat(m[2]) : NaN };
    };

    // Capture the deeply-nested target's position before any click.
    const t2Pos = parseTranslate(findPrdNode(root, "Task Two")!);

    await clickPrd(root, "Task Two");

    const vb = parseViewBox();
    // After recenter, the viewBox center (vb.x + vb.w/2, vb.y + vb.h/2)
    // should sit on the clicked node's coordinates.
    expect(vb.x + vb.w / 2).toBeCloseTo(t2Pos.x, 3);
    expect(vb.y + vb.h / 2).toBeCloseTo(t2Pos.y, 3);
  });

  // ── Front-matter summary ───────────────────────────────────────────────────

  it("renders a front-matter summary with title, status, priority, and tags on click", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress", priority: "high", tags: ["alpha", "beta"] },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high", tags: ["graph"] },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Epic One");
    await waitFor(() => {
      expect(root.querySelector(".mg-detail-prd")).not.toBeNull();
    });

    const panel = root.querySelector(".mg-detail-prd")!;
    expect(panel.querySelector(".mg-detail-subject")?.textContent).toBe("Epic One");
    expect(panel.querySelector(".mg-detail-title")?.textContent).toBe("EPIC");
    expect(panel.textContent).toContain("in progress");
    expect(panel.textContent).toContain("high");
    const tagEls = panel.querySelectorAll(".mg-frontmatter-tag");
    expect([...tagEls].map((t) => t.textContent)).toEqual(["alpha", "beta"]);
  });

  it("renders an em dash for missing priority/tags without breaking layout", async () => {
    mountWithPrd([
      // Intentionally omit priority and tags on T2.
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending", priority: "high" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task Two");
    await waitFor(() => {
      expect(root.querySelector(".mg-detail-prd")).not.toBeNull();
    });

    const panel = root.querySelector(".mg-detail-prd")!;
    const dds = [...panel.querySelectorAll<HTMLElement>("dd")];
    expect(dds.length).toBe(3);
    expect(dds[1].textContent).toBe("—");
    expect(dds[2].querySelector(".mg-frontmatter-empty")?.textContent).toBe("—");
    expect(panel.querySelectorAll(".mg-frontmatter-tag").length).toBe(0);
  });

  // ── Origin section (lazy fetch) ────────────────────────────────────────────

  it("fetches and renders the introducing-commit origin when a PRD node is clicked", async () => {
    const origin = {
      sha: "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1",
      shortSha: "f1f1f1f",
      createdAt: "2026-05-02T10:00:00Z",
      author: "Hal",
      authorEmail: "hal@example.com",
      coAuthors: [
        { name: "Claude", email: "noreply@anthropic.com" },
      ],
      subject: "feat: introduce Task Two",
    };
    mountWithPrd(
      [
        { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
        { id: "F1", title: "Feature One", level: "feature", status: "pending" },
        { id: "T1", title: "Task One", level: "task", status: "pending" },
        { id: "T2", title: "Task Two", level: "task", status: "pending" },
        { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
      ],
      {
        originHandler: (url: string) => {
          // Path is URL-encoded; verify it carries the correct treePath.
          expect(url).toContain("path=epic-one%2Ffeature-one%2Ftask-two");
          return Promise.resolve(new Response(JSON.stringify({ origin }), { status: 200 }));
        },
      },
    );

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task Two");
    await waitFor(() => {
      expect(root.querySelector(".mg-origin-sha")?.textContent).toBe("f1f1f1f");
    });

    const panel = root.querySelector(".mg-detail-prd")!;
    expect(panel.querySelector(".mg-origin-author")?.textContent).toBe("Hal");
    expect(panel.querySelector(".mg-origin-coauthors")?.textContent ?? "")
      .toContain("Claude");
    expect(panel.querySelector(".mg-origin-subject")?.textContent)
      .toBe("feat: introduce Task Two");
    expect(panel.querySelector(".mg-origin-copy")?.getAttribute("data-full-sha"))
      .toBe(origin.sha);
  });

  it("renders a 'No commit history' state when the origin lookup returns null", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task One");
    await waitFor(() => {
      const status = root.querySelector(".mg-origin-status");
      if (!status || !status.textContent?.includes("No commit history")) {
        throw new Error("waiting for no-commit-history state");
      }
    });
  });

  // ── Merge metadata panel ───────────────────────────────────────────────────

  it("renders the empty/instructional merge metadata panel before any selection", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const panel = root.querySelector(".mg-meta-panel");
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains("mg-meta-empty")).toBe(true);
    expect(panel!.querySelector(".mg-meta-instruction")?.textContent ?? "")
      .toMatch(/select a node/i);
    expect(root.querySelector(".mg-meta-row")).toBeNull();
  });

  it("renders timestamp, short SHA, and author when a linked PRD node is selected", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task One");
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });

    const row = root.querySelector(".mg-meta-row")!;
    expect(row.querySelector(".mg-meta-sha-text")?.textContent).toBe("abcdef1");
    expect(row.querySelector(".mg-meta-author")?.textContent).toBe("alice");
    expect(row.querySelector("time")?.getAttribute("datetime"))
      .toBe("2026-05-01T00:00:00Z");
    expect(row.querySelector(".mg-meta-copy")?.getAttribute("data-full-sha"))
      .toBe("abcdef1");
  });

  it("shows 'no merge recorded' for a PRD node with no linked merges", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task Two");
    await waitFor(() => {
      const panel = root.querySelector(".mg-meta-panel");
      if (!panel || !panel.classList.contains("mg-meta-no-merge")) {
        throw new Error("waiting for no-merge state");
      }
    });

    const panel = root.querySelector(".mg-meta-panel")!;
    expect(panel.querySelector(".mg-meta-status")?.textContent).toBe("No merge recorded");
    expect(panel.querySelector(".mg-meta-context")?.textContent).toContain("Task Two");
    expect(root.querySelector(".mg-meta-row")).toBeNull();
  });

  it("copies the full commit hash to the clipboard when the merge meta copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task One");
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-copy")).not.toBeNull();
    });

    const button = root.querySelector<HTMLButtonElement>(".mg-meta-copy")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("abcdef1");
  });

  it("updates the metadata panel synchronously when the selection changes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    await clickPrd(root, "Task One");
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });

    await clickPrd(root, "Task Two");
    await waitFor(() => {
      const panel = root.querySelector(".mg-meta-panel");
      if (!panel || !panel.classList.contains("mg-meta-no-merge")) {
        throw new Error("waiting for no-merge state");
      }
    });
    expect(root.querySelector(".mg-meta-row")).toBeNull();

    await clickPrd(root, "Task One");
    await waitFor(() => {
      expect(root.querySelector(".mg-meta-row")).not.toBeNull();
    });
    expect(root.querySelector(".mg-meta-no-merge")).toBeNull();
  });

  it("does not refetch the merge graph when the selection changes", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const initialMergeFetches = fetchSpy.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("/api/merge-graph"))
      .length;
    expect(initialMergeFetches).toBe(1);

    await clickPrd(root, "Task One");
    await clickPrd(root, "Task Two");
    await clickPrd(root, "Epic One");

    const finalMergeFetches = fetchSpy.mock.calls
      .filter(([url]) => typeof url === "string" && url.startsWith("/api/merge-graph"))
      .length;
    expect(finalMergeFetches).toBe(1);
  });

  // ── Layout (regression: compact folder-tree rhythm) ──────────────────────

  it("places parents above children in the top-down layout", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const parseY = (el: SVGGElement): number => {
      const t = el.getAttribute("transform") ?? "";
      const m = /translate\(([^,]+),([^)]+)\)/.exec(t);
      return m ? parseFloat(m[2]) : NaN;
    };

    const e1y = parseY(findPrdNode(root, "Epic One")!);
    const f1y = parseY(findPrdNode(root, "Feature One")!);
    const t1y = parseY(findPrdNode(root, "Task One")!);
    expect(Number.isFinite(e1y) && Number.isFinite(f1y) && Number.isFinite(t1y)).toBe(true);
    expect(e1y).toBeLessThan(f1y);
    expect(f1y).toBeLessThan(t1y);
  });

  /**
   * Locks in the new rhythm so a future "let's spread the graph out again"
   * change registers as an obvious snapshot diff. Captures, for the standard
   * 4-node PRD fixture (E1 → F1 → T1, T2 + E2), each node's position, the
   * overall vertical span, and the indent rhythm.
   */
  it("renders the compact folder-tree layout for a representative PRD fixture", async () => {
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    const parseXY = (el: SVGGElement): { x: number; y: number } => {
      const t = el.getAttribute("transform") ?? "";
      const m = /translate\(([^,]+),([^)]+)\)/.exec(t);
      if (!m) throw new Error(`missing transform: ${t}`);
      return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    };

    const positions: Record<string, { x: number; y: number }> = {};
    for (const title of ["Epic One", "Feature One", "Task One", "Task Two", "Epic Two"]) {
      const node = findPrdNode(root, title);
      expect(node, `${title} should be visible`).toBeTruthy();
      positions[title] = parseXY(node!);
    }

    // Snapshot: exact positions for the compact folder-tree layout.
    //   • Indent (x): epic=0, feature=22, task=44 — every level adds INDENT_W.
    //   • Pitch  (y): every visible node owns a row of ROW_H=22 in DFS
    //     pre-order, so the column reads as a single tight stack.
    expect(positions).toEqual({
      "Epic One":    { x: 0,  y: 0 },
      "Feature One": { x: 22, y: 22 },
      "Task One":    { x: 44, y: 44 },
      "Task Two":    { x: 44, y: 66 },
      "Epic Two":    { x: 0,  y: 88 },
    });

    const ys = Object.values(positions).map((p) => p.y);
    const verticalSpan = Math.max(...ys) - Math.min(...ys);
    expect(verticalSpan).toBeLessThanOrEqual(100);

    const sortedYs = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sortedYs.length; i++) {
      expect(sortedYs[i] - sortedYs[i - 1]).toBe(22);
    }

    const colLabels = root.querySelectorAll(".mg-col-label");
    expect(colLabels.length).toBe(1);
    expect(colLabels[0].textContent).toBe("MERGES");

    const treeEdgeDs = [...root.querySelectorAll<SVGPathElement>(".mg-edge-tree")]
      .map((p) => p.getAttribute("d") ?? "");
    expect(treeEdgeDs.length).toBeGreaterThan(0);
    for (const d of treeEdgeDs) {
      expect(d).not.toMatch(/[CcQqSsTt]/);
      expect(d).toMatch(/^M[^L]+L[^L]+L[^L]+$/);
    }
  });

  // ── Color encoding ────────────────────────────────────────────────────────

  it("colors each PRD node by its shape, not its status", async () => {
    // Two epics with different statuses but the same shape should share a
    // fill — the user-facing contract is "shape ⇒ color". Status is encoded
    // by the glyph prefix in the node label (▶ ⊘ ✓ etc.).
    mountWithPrd([
      { id: "E1", title: "Epic One", level: "epic", status: "in_progress" },
      { id: "F1", title: "Feature One", level: "feature", status: "pending" },
      { id: "T1", title: "Task One", level: "task", status: "pending" },
      { id: "T2", title: "Task Two", level: "task", status: "pending" },
      { id: "E2", title: "Epic Two", level: "epic", status: "pending" },
    ]);

    await waitFor(() => {
      expect(root.querySelectorAll(".mg-prd-node").length).toBe(5);
    });

    // T1 is a leaf → triangle → var(--brand-rose)
    const t1Shape = findPrdNode(root, "Task One")!.querySelector(".mg-shape");
    expect(t1Shape?.getAttribute("fill")).toBe("var(--brand-rose)");

    // E2 is also a leaf (no fixture children) → triangle → same color
    const e2Shape = findPrdNode(root, "Epic Two")!.querySelector(".mg-shape");
    expect(e2Shape?.getAttribute("fill")).toBe("var(--brand-rose)");
  });
});
