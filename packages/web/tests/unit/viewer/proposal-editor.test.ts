// @vitest-environment jsdom
/**
 * Tests for the ProposalEditor component.
 *
 * Covers: initial rendering from raw proposals, selection toggling
 * (cascading deselect/select), title editing, validation errors on
 * empty titles, select all/none, and submission flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  ProposalEditor,
  type RawProposal,
} from "../../../src/viewer/components/prd-tree/proposal-editor.js";

function makeProposal(
  epicTitle = "Test Epic",
  featureOverrides: Array<{
    title?: string;
    tasks?: Array<{ title?: string; priority?: string; tags?: string[] }>;
  }> = [{}],
): RawProposal {
  return {
    epic: { title: epicTitle, source: "test", description: "Epic desc" },
    features: featureOverrides.map((fo, fi) => ({
      title: fo.title ?? `Feature ${fi + 1}`,
      source: "test",
      description: `Feature ${fi + 1} desc`,
      tasks: (fo.tasks ?? [{ title: `Task 1` }]).map((to, ti) => ({
        title: to.title ?? `Task ${ti + 1}`,
        source: "test",
        sourceFile: "test.ts",
        description: `Task ${ti + 1} desc`,
        priority: to.priority,
        tags: to.tags,
      })),
    })),
  };
}

describe("ProposalEditor", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
    vi.useRealTimers();
  });

  function renderEditor(
    proposals: RawProposal[],
    overrides: { onAccepted?: () => void; onCancel?: () => void } = {},
  ) {
    act(() => {
      render(
        h(ProposalEditor, {
          proposals,
          onAccepted: overrides.onAccepted ?? vi.fn(),
          onCancel: overrides.onCancel ?? vi.fn(),
        }),
        root,
      );
      vi.advanceTimersByTime(0);
    });
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  describe("initial rendering", () => {
    it("renders the editor with header", () => {
      renderEditor([makeProposal()]);
      expect(root.querySelector(".proposal-editor-title")?.textContent).toBe("Review & Edit Proposals");
    });

    it("renders epic title input with correct value", () => {
      renderEditor([makeProposal("My Epic")]);
      const inputs = root.querySelectorAll<HTMLInputElement>(".proposal-editor-input-title");
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs[0].value).toBe("My Epic");
    });

    it("renders feature and task nodes", () => {
      renderEditor([makeProposal("Epic", [
        { title: "Feat A", tasks: [{ title: "Task X" }, { title: "Task Y" }] },
      ])]);

      const featureBadges = root.querySelectorAll(".prd-level-feature");
      expect(featureBadges.length).toBe(1);
      // Epic is expanded by default, so feature header is visible
      const featureInputs = root.querySelectorAll<HTMLInputElement>(".proposal-editor-feature .proposal-editor-input-title");
      expect(featureInputs.length).toBe(1);
      expect(featureInputs[0].value).toBe("Feat A");
    });

    it("shows count badges in toolbar", () => {
      renderEditor([makeProposal("E", [
        { tasks: [{ title: "T1" }, { title: "T2" }] },
        { tasks: [{ title: "T3" }] },
      ])]);

      const badges = root.querySelectorAll(".proposal-editor-count-badge");
      expect(badges.length).toBe(3); // epics, features, tasks
      expect(badges[0].textContent).toBe("1 epic");
      expect(badges[1].textContent).toBe("2 features");
      expect(badges[2].textContent).toBe("3 tasks");
    });
  });

  // ─── Selection ─────────────────────────────────────────────────────

  describe("selection", () => {
    it("all items are selected by default", () => {
      renderEditor([makeProposal()]);
      const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(true);
      }
    });

    it("deselecting epic cascades to features and tasks", () => {
      renderEditor([makeProposal("Epic", [
        { tasks: [{ title: "T1" }] },
      ])]);

      // Find epic checkbox (first one)
      const epicCheckbox = root.querySelector<HTMLInputElement>(
        '.proposal-editor-epic-header input[type="checkbox"]',
      );
      expect(epicCheckbox).not.toBeNull();

      act(() => {
        epicCheckbox!.click();
        vi.advanceTimersByTime(0);
      });

      // All checkboxes should be unchecked
      const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(false);
      }
    });

    it("select none deselects all items", () => {
      renderEditor([makeProposal("E", [{ tasks: [{ title: "T" }] }])]);

      const selectNoneBtn = Array.from(root.querySelectorAll<HTMLButtonElement>(".proposal-editor-select-btn"))
        .find((b) => b.textContent === "Select None");
      expect(selectNoneBtn).not.toBeUndefined();

      act(() => {
        selectNoneBtn!.click();
        vi.advanceTimersByTime(0);
      });

      const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(false);
      }
    });

    it("select all re-selects all items", () => {
      renderEditor([makeProposal("E", [{ tasks: [{ title: "T" }] }])]);

      // First deselect all
      const selectNoneBtn = Array.from(root.querySelectorAll<HTMLButtonElement>(".proposal-editor-select-btn"))
        .find((b) => b.textContent === "Select None");
      act(() => {
        selectNoneBtn!.click();
        vi.advanceTimersByTime(0);
      });

      // Then select all
      const selectAllBtn = Array.from(root.querySelectorAll<HTMLButtonElement>(".proposal-editor-select-btn"))
        .find((b) => b.textContent === "Select All");
      act(() => {
        selectAllBtn!.click();
        vi.advanceTimersByTime(0);
      });

      const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      for (const cb of checkboxes) {
        expect(cb.checked).toBe(true);
      }
    });
  });

  // ─── Action buttons ────────────────────────────────────────────────

  describe("action buttons", () => {
    it("renders cancel and accept buttons", () => {
      renderEditor([makeProposal()]);
      expect(root.querySelector(".proposal-editor-btn-cancel")).not.toBeNull();
      expect(root.querySelector(".proposal-editor-btn-accept")).not.toBeNull();
    });

    it("accept button shows item count", () => {
      renderEditor([makeProposal("E", [
        { tasks: [{ title: "T1" }, { title: "T2" }] },
      ])]);

      const acceptBtn = root.querySelector<HTMLButtonElement>(".proposal-editor-btn-accept");
      // 1 epic + 1 feature + 2 tasks = 4 items
      expect(acceptBtn!.textContent).toBe("Accept 4 Items");
    });

    it("accept button is disabled when nothing is selected", () => {
      renderEditor([makeProposal()]);

      // Deselect all
      const selectNoneBtn = Array.from(root.querySelectorAll<HTMLButtonElement>(".proposal-editor-select-btn"))
        .find((b) => b.textContent === "Select None");
      act(() => {
        selectNoneBtn!.click();
        vi.advanceTimersByTime(0);
      });

      const acceptBtn = root.querySelector<HTMLButtonElement>(".proposal-editor-btn-accept");
      expect(acceptBtn!.disabled).toBe(true);
    });

    it("cancel button calls onCancel", () => {
      const onCancel = vi.fn();
      renderEditor([makeProposal()], { onCancel });

      const cancelBtn = root.querySelector<HTMLButtonElement>(".proposal-editor-btn-cancel");
      act(() => { cancelBtn!.click(); });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Validation ────────────────────────────────────────────────────

  describe("validation", () => {
    it("shows validation errors for empty titles on submit attempt", async () => {
      vi.stubGlobal("fetch", vi.fn());

      renderEditor([makeProposal("")]);

      const acceptBtn = root.querySelector<HTMLButtonElement>(".proposal-editor-btn-accept");
      await act(async () => {
        acceptBtn!.click();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(root.querySelector(".proposal-editor-errors")).not.toBeNull();
      expect(root.textContent).toContain("validation error");
      expect(root.textContent).toContain("Epic title is required");
    });
  });

  // ─── Expand/collapse ──────────────────────────────────────────────

  describe("expand/collapse", () => {
    it("epics are expanded by default", () => {
      renderEditor([makeProposal("E", [{ title: "F1" }])]);

      // Feature should be visible since epic is expanded
      expect(root.querySelector(".proposal-editor-feature")).not.toBeNull();
    });

    it("features are collapsed by default", () => {
      renderEditor([makeProposal("E", [{ tasks: [{ title: "T" }] }])]);

      // Feature body (with description textarea) should not be visible
      expect(root.querySelector(".proposal-editor-feature-body")).toBeNull();
    });

    it("clicking feature expand button shows feature body", () => {
      renderEditor([makeProposal("E", [{ tasks: [{ title: "T" }] }])]);

      const expandBtn = root.querySelector<HTMLButtonElement>(".proposal-editor-feature .proposal-editor-expand");
      act(() => {
        expandBtn!.click();
        vi.advanceTimersByTime(0);
      });

      expect(root.querySelector(".proposal-editor-feature-body")).not.toBeNull();
    });
  });
});
