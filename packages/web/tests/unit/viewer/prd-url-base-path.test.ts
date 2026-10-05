// @vitest-environment jsdom
/**
 * The PRD view rewrites the URL as items are selected, deep-linked and
 * deleted. Behind the hub that URL must keep `/p/<id>` (and `/w/<key>`), or a
 * reload with several projects registered lands on the hub's 409.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { setBasePathForTests } from "../../../src/viewer/base-path.js";
import { buildShareableUrl } from "../../../src/viewer/components/copy-link-button.js";
import { useItemSelection } from "../../../src/viewer/hooks/use-item-selection.js";
import { usePRDDeepLink } from "../../../src/viewer/hooks/use-prd-deep-link.js";
import { useDeleteActions } from "../../../src/viewer/hooks/use-delete-actions.js";
import type { PRDDocumentData, PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

const ITEM = { id: "t1", title: "T", level: "task", status: "pending" } as PRDItemData;
const DOC = { schema: "rex/v1", title: "P", items: [ITEM] } as PRDDocumentData;

const BASES = ["/p/n-dx", "/p/n-dx/w/feat"] as const;

describe.each(BASES)("PRD URLs under base path %s", (base) => {
  let root: HTMLDivElement;
  let replace: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setBasePathForTests(base);
    root = document.createElement("div");
    document.body.appendChild(root);
    replace = vi.spyOn(history, "replaceState").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setBasePathForTests(null);
  });

  const lastUrl = () => replace.mock.calls.at(-1)?.[2];

  it("selecting an item keeps the prefix", () => {
    let selectItem!: (item: PRDItemData) => void;
    function Harness() {
      selectItem = useItemSelection({ data: DOC }).handleSelectItem;
      return null;
    }
    act(() => { render(h(Harness, null), root); });
    act(() => { selectItem(ITEM); });
    expect(lastUrl()).toBe(`${base}/prd/t1`);
  });

  it("a deep link to a missing task cleans back to the prefixed /prd", () => {
    function Harness() {
      usePRDDeepLink({ initialTaskId: "nope", loading: false, data: DOC, onSelectItem: () => undefined });
      return null;
    }
    act(() => { render(h(Harness, null), root); });
    expect(lastUrl()).toBe(`${base}/prd`);
  });

  it("deleting the selected item keeps the prefix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ level: "task", title: "T" }), { status: 200 }),
    ));
    let remove!: (id: string) => Promise<void>;
    function Harness() {
      remove = useDeleteActions({
        data: DOC,
        setData: () => undefined,
        fetchPRDData: async () => undefined,
        fetchTaskUsage: async () => undefined,
        showToast: () => undefined,
        selectedItemId: "t1",
        setSelectedItemId: () => undefined,
        setBulkSelectedIds: () => undefined,
      }).handleConfirmDelete;
      return null;
    }
    act(() => { render(h(Harness, null), root); });
    await act(async () => { await remove("t1"); });
    expect(lastUrl()).toBe(`${base}/prd`);
  });

  it("copied and shareable PRD links carry the prefix", () => {
    expect(buildShareableUrl("/prd/t1")).toBe(`${location.origin}${base}/prd/t1`);
  });
});

describe("PRD URLs standalone", () => {
  it("stay root-relative", () => {
    setBasePathForTests("");
    expect(buildShareableUrl("/prd/t1")).toBe(`${location.origin}/prd/t1`);
    setBasePathForTests(null);
  });
});
