/**
 * `ndx start --preview` was removed. The flag is refused, not ignored: ignored,
 * `ndx start --preview stop` would fall through to stopping the dashboard.
 */

import { describe, it, expect, vi } from "vitest";
import { runWeb } from "../../packages/core/web.js";

describe("ndx start --preview", () => {
  it.each([[["--preview"]], [["--preview", "stop"]]])("refuses %j before touching any server", async (rest) => {
    const run = vi.fn();
    const exit = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runWeb(".", rest, { exit, flushExit: async () => {}, run, tools: { web: "web.js" }, __dir: ".", commandName: "start" });
      expect(exit).toHaveBeenCalledWith(1);
      expect(run).not.toHaveBeenCalled();
      expect(errors.mock.calls.flat().join("\n")).toContain("--preview was removed");
    } finally {
      errors.mockRestore();
    }
  });
});
