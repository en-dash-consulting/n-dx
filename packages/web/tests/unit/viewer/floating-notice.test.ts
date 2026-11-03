// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { FloatingNotice } from "../../../src/viewer/components/floating-notice.js";

 describe("floating notices", () => {
  it("joins route notices to the shell stack and removes only the dismissed one", () => {
    const root = document.createElement("div");
    const stack = document.createElement("div");
    stack.className = "status-dock";
    document.body.append(root, stack);
    try {
      const view = (second: boolean) => h("div", null,
        h(FloatingNotice, { key: "persistent" }, h("div", { role: "status" }, "Still running")),
        second ? h(FloatingNotice, { key: "toast" }, h("div", { role: "status" }, "Saved")) : null);
      act(() => render(view(true), root));
      expect(stack.textContent).toBe("Still runningSaved");
      expect(root.textContent).toBe("");
      act(() => render(view(false), root));
      expect(stack.textContent).toBe("Still running");
      expect(stack.querySelectorAll('[role="status"]')).toHaveLength(1);
    } finally {
      act(() => render(null, root));
      root.remove();
      stack.remove();
    }
  });
});
