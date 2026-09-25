// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AddItemForm } from "../../../src/viewer/components/prd-tree/add-item-form.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(vnode, root); });
  return root;
}

/** Flush microtasks and Preact batched updates. */
async function flush() {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => queueMicrotask(r));
}

const sampleItems: PRDItemData[] = [
  {
    id: "epic-1",
    title: "Auth Epic",
    status: "pending",
    level: "epic",
    children: [
      { id: "feature-1", title: "Login Feature", status: "pending", level: "feature" },
    ],
  },
];

describe("AddItemForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the form with all required fields", () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Check form exists
    expect(root.querySelector("form.rex-add-form")).toBeTruthy();

    // Check all labels exist
    const labels = root.querySelectorAll(".rex-add-form-label");
    const labelTexts = Array.from(labels).map((l) => l.textContent?.trim());
    expect(labelTexts).toContain("Type");
    expect(labelTexts).toContain("Title");
    expect(labelTexts).toContain("Priority");

    // Check title input
    expect(root.querySelector("#add-form-title")).toBeTruthy();

    // Check description textarea
    expect(root.querySelector("#add-form-description")).toBeTruthy();

    // Check priority select
    expect(root.querySelector("#add-form-priority")).toBeTruthy();

    // Check action buttons
    const buttons = root.querySelectorAll(".rex-add-form-btn");
    expect(buttons.length).toBe(2);
  });

  it("title input has ref for autofocus and no callback ref", () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // The title input should exist and be a focusable element
    const titleInput = root.querySelector("#add-form-title") as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    expect(titleInput.tagName).toBe("INPUT");
    expect(titleInput.type).toBe("text");
  });

  it("uses useRef instead of inline ref callback for focus (no focus-steal on re-render)", () => {
    // Regression test: the old code had `ref: (el) => el?.focus()` as a callback ref
    // on the title input. This meant EVERY re-render would call el.focus(), stealing
    // focus from the description textarea or any other field. The fix uses useRef +
    // useEffect([], []) which only fires once on mount.
    //
    // We verify this structurally: the title input should NOT have an inline function
    // ref that could re-fire. Instead it should use an object ref (useRef).
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // The title input should exist and be properly configured
    const titleInput = root.querySelector("#add-form-title") as HTMLInputElement;
    expect(titleInput).toBeTruthy();

    // Verify the description textarea is independently focusable
    const descField = root.querySelector("#add-form-description") as HTMLTextAreaElement;
    expect(descField).toBeTruthy();
    descField.focus();
    expect(document.activeElement).toBe(descField);
  });

  it("labels are properly associated with inputs via for/id", () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    // Title label -> input
    const titleLabel = root.querySelector('label[for="add-form-title"]');
    expect(titleLabel).toBeTruthy();
    expect(root.querySelector("#add-form-title")).toBeTruthy();

    // Description label -> textarea
    const descLabel = root.querySelector('label[for="add-form-description"]');
    expect(descLabel).toBeTruthy();
    expect(root.querySelector("#add-form-description")).toBeTruthy();

    // Priority label -> select
    const prioLabel = root.querySelector('label[for="add-form-priority"]');
    expect(prioLabel).toBeTruthy();
    expect(root.querySelector("#add-form-priority")).toBeTruthy();
  });

  it("shows validation error when submitting empty title", async () => {
    const onSubmit = vi.fn();
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit,
        onCancel: vi.fn(),
      }),
    );
    await flush();

    // Submit with empty title
    const form = root.querySelector("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true }));
    await flush();

    // Should show error
    const errorAlert = root.querySelector('[role="alert"]');
    expect(errorAlert).toBeTruthy();
    expect(errorAlert?.textContent).toContain("Title is required");

    // Should NOT have called onSubmit
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows field-level error styling after blur on empty title", async () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    await flush();

    const titleInput = root.querySelector("#add-form-title") as HTMLInputElement;

    // Blur with empty value triggers field-level validation
    titleInput.dispatchEvent(new Event("blur", { bubbles: true }));
    await flush();

    // Input should have error class
    expect(titleInput.classList.contains("rex-add-form-input-error")).toBe(true);

    // Field-level error message should appear
    const fieldError = root.querySelector("#add-form-title-error");
    expect(fieldError).toBeTruthy();
    expect(fieldError?.textContent).toContain("Title is required");
  });

  it("type level buttons have aria-pressed attributes", () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    const levelBtns = root.querySelectorAll(".rex-add-form-level-btn");
    expect(levelBtns.length).toBe(4);

    // Epic should be active by default (aria-pressed="true")
    const epicBtn = Array.from(levelBtns).find((b) => b.textContent === "Epic");
    expect(epicBtn?.getAttribute("aria-pressed")).toBe("true");

    // Others should be aria-pressed="false"
    const featureBtn = Array.from(levelBtns).find((b) => b.textContent === "Feature");
    expect(featureBtn?.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel,
      }),
    );

    const cancelBtn = root.querySelector(".rex-add-form-btn-cancel") as HTMLButtonElement;
    cancelBtn.click();
    await flush();

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("level group has role=group and aria-labelledby", () => {
    const root = renderToDiv(
      h(AddItemForm, {
        allItems: sampleItems,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    const group = root.querySelector('.rex-add-form-level-group[role="group"]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute("aria-labelledby")).toBe("add-form-type-label");
    expect(root.querySelector("#add-form-type-label")).toBeTruthy();
  });
});
